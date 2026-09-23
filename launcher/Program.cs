using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

// IELTS Writing Coach local launcher (Windows, .NET Framework 4.x).
// Build with scripts/build-launcher.ps1 (uses the system csc.exe).
// Behavior: probe http://127.0.0.1:3000/api/health; if not running, start
// `npm run dev:local` hidden (logs to %LOCALAPPDATA%\IELTS Writing Coach\server.log),
// wait for health, then open http://ieltswriting.localhost:3000 in the default browser.
// On failure show a plain-language message box with the log path (no stack trace).
internal static class Program
{
    private static string AppRoot()
    {
        // exe lives in <root>\dist\; the project root is its parent.
        // BaseDirectory always ends with a directory separator ("...\dist\").
        // Trim the trailing separator first so GetParent returns the real parent
        // ("...\雅思作文助手") instead of the dist directory itself.
        var exeDir = AppDomain.CurrentDomain.BaseDirectory;
        if (exeDir.Length > 1 && (exeDir.EndsWith("\\") || exeDir.EndsWith("/")))
        {
            exeDir = exeDir.Substring(0, exeDir.Length - 1);
        }
        var parent = Directory.GetParent(exeDir);
        return parent != null ? parent.FullName : exeDir;
    }

    private static string LogPath()
    {
        var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "IELTS Writing Coach");
        Directory.CreateDirectory(logDir);
        return Path.Combine(logDir, "server.log");
    }

    private static bool IsHealthy()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3000/api/health");
            request.Timeout = 2000;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode == 200;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OpenBrowser()
    {
        try
        {
            Process.Start("http://ieltswriting.localhost:3000");
        }
        catch
        {
            Process.Start("http://127.0.0.1:3000");
        }
    }

    private static void StartServer(string root, string logPath)
    {
        // Launch npm through cmd.exe (/d /s /c). A bare "npm.cmd" name with
        // UseShellExecute=false breaks npm's prefix resolution on Windows
        // (npm-prefix.js MODULE_NOT_FOUND); cmd.exe /c avoids that pitfall.
        // Redirection happens INSIDE cmd (>> log 2>&1) so this launcher does
        // not hold stdout/stderr pipes: when the launcher exits after opening
        // the browser, the dev server keeps writing to the file instead of
        // blocking on a closed pipe.
        var comSpec = Environment.GetEnvironmentVariable("ComSpec");
        var quotedLog = "\"" + logPath + "\"";
        var info = new ProcessStartInfo
        {
            FileName = string.IsNullOrEmpty(comSpec) ? "cmd.exe" : comSpec,
            Arguments = "/d /s /c \"npm run dev:local >> " + quotedLog + " 2>&1\"",
            WorkingDirectory = root,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
        };
        var process = new Process { StartInfo = info };
        process.Start();
    }

    [STAThread]
    private static void Main(string[] args)
    {
        // Test/verification hook: write the resolved project root to a temp
        // marker file and exit. A GUI-subsystem exe has no readable stdout,
        // so the automated test reads this marker (launcher-build.test.ts).
        if (args.Length == 1 && args[0] == "--print-root")
        {
            var marker = Path.Combine(Path.GetTempPath(), "ielts-writing-coach-launcher-root.txt");
            File.WriteAllText(marker, AppRoot());
            return;
        }
        var logPath = LogPath();
        if (IsHealthy())
        {
            OpenBrowser();
            return;
        }
        try
        {
            StartServer(AppRoot(), logPath);
        }
        catch
        {
            MessageBox.Show(
                "无法启动 IELTS Writing Coach 服务。\n\n日志路径：" + logPath +
                "\n\n常见原因：项目依赖未安装（node_modules 缺失）或系统缺少 Node.js/npm。",
                "IELTS Writing Coach",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            Thread.Sleep(1000);
            if (IsHealthy())
            {
                OpenBrowser();
                return;
            }
        }
        MessageBox.Show(
            "IELTS Writing Coach 服务未能及时启动，请查看日志：\n" + logPath,
            "IELTS Writing Coach",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
