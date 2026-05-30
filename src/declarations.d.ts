declare module 'gradient-string' {
  type GradientFunction = (text: string) => string;

  interface Gradient {
    (text: string): string;
    (...colors: string[]): GradientFunction;
  }

  const gradient: {
    (...colors: string[]): GradientFunction;
    atlas: GradientFunction;
    cristal: GradientFunction;
    teen: GradientFunction;
    mind: GradientFunction;
    morning: GradientFunction;
    vice: GradientFunction;
    passion: GradientFunction;
    fruit: GradientFunction;
    instagram: GradientFunction;
    retro: GradientFunction;
    summer: GradientFunction;
    rainbow: GradientFunction;
    pastel: GradientFunction;
  };

  export default gradient;
}

declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  interface TerminalRendererOptions {
    code?: (code: string, lang: string) => string;
    blockquote?: (quote: string) => string;
    html?: (html: string) => string;
    heading?: (text: string, level: number) => string;
    firstHeading?: (text: string, level: number) => string;
    hr?: () => string;
    listitem?: (text: string) => string;
    list?: (body: string, ordered: boolean) => string;
    paragraph?: (text: string) => string;
    table?: (header: string, body: string) => string;
    tablerow?: (content: string) => string;
    tablecell?: (content: string, flags: { header: boolean; align: string | null }) => string;
    strong?: (text: string) => string;
    em?: (text: string) => string;
    codespan?: (text: string) => string;
    del?: (text: string) => string;
    link?: (href: string, title: string | null, text: string) => string;
    image?: (href: string, title: string | null, text: string) => string;
    br?: () => string;
    text?: (text: string) => string;
    emoji?: boolean;
    width?: number;
    reflowText?: boolean;
    showSectionPrefix?: boolean;
    unescape?: boolean;
    tab?: number;
    tableOptions?: Record<string, unknown>;
  }

  export function markedTerminal(options?: TerminalRendererOptions): MarkedExtension;
}
