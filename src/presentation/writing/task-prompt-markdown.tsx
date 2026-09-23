import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

type Props = {
  source: string;
  renderMarkdown?: (source: string) => ReactNode;
};

class PromptRenderBoundary extends Component<{ source: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p data-testid="task-prompt-plain-fallback">{this.props.source}</p>;
    return this.props.children;
  }
}

function MarkdownContent({ source, renderMarkdown }: Props) {
  if (renderMarkdown) return renderMarkdown(source);
  return <ReactMarkdown components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{children}</a> }}>{source}</ReactMarkdown>;
}

export function TaskPromptMarkdown({ source, renderMarkdown }: Props) {
  return <PromptRenderBoundary key={source} source={source}><MarkdownContent source={source} renderMarkdown={renderMarkdown} /></PromptRenderBoundary>;
}
