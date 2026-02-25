const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

function color(code: number, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const green = (t: string) => color(32, t);
export const yellow = (t: string) => color(33, t);
export const red = (t: string) => color(31, t);
export const dim = (t: string) => color(2, t);
export const bold = (t: string) => color(1, t);

export function printBanner(): void {
  console.log(dim("  cachebash — MCP agent coordination\n"));
}

export function printHelp(): void {
  console.log(`${bold("Usage:")} cachebash <command>

${bold("Commands:")}
  init          Set up CacheBash MCP connection
  init --key    Use an existing API key
  ping          Test MCP connectivity
  feedback      Submit feedback (bug report, feature request, or general)

${bold("Feedback:")}
  cachebash feedback "your message"
  cachebash feedback --type bug "description of the issue"
  cachebash feedback -t feature "I'd like to see..."

${bold("Options:")}
  --help        Show this help message
`);
}

export function printSuccess(msg: string): void {
  console.log(`${green("✓")} ${msg}`);
}

export function printWarning(msg: string): void {
  console.log(`${yellow("!")} ${msg}`);
}

export function printError(msg: string): void {
  console.error(`${red("✗")} ${msg}`);
}

export function printStep(msg: string): void {
  console.log(`${dim("→")} ${msg}`);
}

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private interval: ReturnType<typeof setInterval> | null = null;
  private i = 0;

  start(msg: string): void {
    if (!process.stdout.isTTY) {
      console.log(msg);
      return;
    }
    this.i = 0;
    this.interval = setInterval(() => {
      process.stdout.write(`\r${dim(this.frames[this.i++ % this.frames.length])} ${msg}`);
    }, 80);
  }

  stop(msg?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write("\r\x1b[K");
    }
    if (msg) console.log(msg);
  }
}
