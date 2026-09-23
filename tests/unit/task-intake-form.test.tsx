// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";import{cleanup,fireEvent,render,screen,waitFor}from"@testing-library/react";import{TaskIntakeForm}from"../../src/presentation/task-intake/task-intake-form";
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe("task intake form",()=>{it("shows the selected filename, uploads one image and navigates",async()=>{const navigate=vi.fn();vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({sessionId:"s"}),{status:201}));render(<TaskIntakeForm navigate={navigate}/>);expect(screen.getByText("Choose Task 1 image")).toBeTruthy();const file=new File([new Uint8Array([137,80,78,71])],"task.png",{type:"image/png"});fireEvent.change(screen.getByLabelText("Task image"),{target:{files:[file]}});fireEvent.change(screen.getByLabelText("Task text"),{target:{value:"Describe the chart."}});expect(screen.getByText("task.png")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Start writing"}));await waitFor(()=>expect(navigate).toHaveBeenCalledWith("/write/s"));});});

it("imports a TXT prompt into the editable shared Task 1 prompt state", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ sessionId: "txt-session" }), { status: 201 }));
  render(<TaskIntakeForm navigate={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("Task image"), {
    target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "task.png", { type: "image/png" })] },
  });
  fireEvent.change(screen.getByLabelText("Task text file"), {
    target: { files: [new File(["# Population\n\n**Summarise** the chart."], "task.txt", { type: "text/plain" })] },
  });

  await waitFor(() => expect((screen.getByLabelText("Task text") as HTMLTextAreaElement).value).toBe("# Population\n\n**Summarise** the chart."));
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "# Population\n\nEdited wording." } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(body.get("promptText")).toBe("# Population\n\nEdited wording.");
  expect(screen.getByText("task.txt")).toBeTruthy();
});

it("uses the compact image-style TXT upload zone for Task 2 and submits imported Markdown", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ sessionId: "task-2-txt" }), { status: 201 }));
  render(<TaskIntakeForm navigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Task 2" }));

  const textInput = screen.getByLabelText("Task text file") as HTMLInputElement;
  const uploadZone = textInput.closest("label");
  expect(uploadZone?.className).toContain("upload-zone");
  expect(uploadZone?.className).toContain("text-upload-zone");
  expect(uploadZone?.querySelector("svg")).toBeTruthy();
  expect(screen.getByText("选择 TXT 题目文件")).toBeTruthy();

  fireEvent.change(textInput, { target: { files: [new File(["# Task 2\n\n**Discuss both views.**"], "task-2.txt", { type: "text/plain" })] } });
  await waitFor(() => expect((screen.getByLabelText("Task text") as HTMLTextAreaElement).value).toContain("**Discuss both views.**"));
  expect(uploadZone?.className).toContain("has-file");
  expect(screen.getByText("TXT 文件已选择")).toBeTruthy();
  expect(screen.getByText("task-2.txt")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
    taskType: "TASK_2",
    txtFileName: "task-2.txt",
    promptText: expect.stringContaining("# Task 2"),
  });
});

it("requires both a Task 1 image and non-empty wording", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  render(<TaskIntakeForm />);

  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "Describe the chart." } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
  expect(screen.getByRole("alert").textContent).toContain("请选择 Task 1 题图");

  fireEvent.change(screen.getByLabelText("Task image"), {
    target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "task.png", { type: "image/png" })] },
  });
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
  expect(screen.getByRole("alert").textContent).toContain("请输入题目文字或上传 TXT 文件");
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [new File(["valid content"], "task.md", { type: "text/markdown" }), "仅支持 TXT 纯文本文件"],
  [new File([new Uint8Array(256 * 1024 + 1)], "task.txt", { type: "text/plain" }), "TXT 文件超过 256 KB"],
  [new File(["   "], "task.txt", { type: "text/plain" }), "TXT 文件没有可用文字"],
])("rejects an invalid TXT while preserving existing wording", async (textFile, message) => {
  render(<TaskIntakeForm />);
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "Existing wording" } });
  fireEvent.change(screen.getByLabelText("Task text file"), { target: { files: [textFile] } });

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
  expect((screen.getByLabelText("Task text") as HTMLTextAreaElement).value).toBe("Existing wording");
});

it("creates Task 2 from required prompt text without rendering image upload", async () => {
  const navigate = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ sessionId: "task-2" }), { status: 201 }));
  render(<TaskIntakeForm navigate={navigate} />);

  fireEvent.click(screen.getByRole("button", { name: "Task 2" }));
  expect(screen.queryByLabelText("Task image")).toBeNull();
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "Discuss both views and give your opinion." } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/write/task-2"));
  expect(fetchMock).toHaveBeenCalledWith("/api/essays", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ taskType: "TASK_2" });
});

it("offers four target bands and persists the chosen band per session in localStorage", async () => {
  const navigate = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ sessionId: "band-session" }), { status: 201 }));
  render(<TaskIntakeForm navigate={navigate} />);

  expect(screen.getByRole("button", { name: /^Target 6\.0$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Target 6\.5$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Target 7\.0$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Target 7\.5$/ })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Task 2" }));
  fireEvent.click(screen.getByRole("button", { name: /^Target 7\.5$/ }));
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "Discuss both views." } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/write/band-session"));
  expect(localStorage.getItem("target-band:band-session")).toBe("7.5");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("explains image format failures and lists supported web image formats", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "IMAGE_SIGNATURE_MISMATCH" }), { status: 415 }));
  render(<TaskIntakeForm />);

  expect(screen.getByText(/JPG\/JPEG、PNG、WEBP/)).toBeTruthy();
  const disguisedJpeg = new File([new Uint8Array([255, 216, 255, 224])], "C20-T2-T1.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Task image"), { target: { files: [disguisedJpeg] } });
  fireEvent.change(screen.getByLabelText("Task text"), { target: { value: "Describe the chart." } });
  fireEvent.click(screen.getByRole("button", { name: "Start writing" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("扩展名与实际图片格式不一致"));
});
