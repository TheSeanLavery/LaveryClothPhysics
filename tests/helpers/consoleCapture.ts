import type { Page } from '@playwright/test';

export interface CapturedConsole {
  readonly errors: string[];
  readonly warnings: string[];
  readonly threeMessages: string[];
  readonly all: string[];
}

const THREE_CONSOLE_PATTERN = /THREE\.(TSL|WebGPU|WGSL)|WGSL|shader compilation|already in use/i;

export function attachConsoleCapture(page: Page): CapturedConsole {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all: string[] = [];

  page.on('pageerror', (error) => {
    errors.push(error.message);
    all.push(`[pageerror] ${error.message}`);
  });

  page.on('console', (msg) => {
    const text = msg.text();
    all.push(`[${msg.type()}] ${text}`);

    if (msg.type() === 'error') {
      errors.push(text);
    }

    if (msg.type() === 'warning') {
      warnings.push(text);
    }

    if (THREE_CONSOLE_PATTERN.test(text)) {
      errors.push(`THREE console: ${text}`);
    }
  });

  return {
    get errors() {
      return errors;
    },
    get warnings() {
      return warnings;
    },
    get threeMessages() {
      return all.filter((line) => THREE_CONSOLE_PATTERN.test(line));
    },
    get all() {
      return all;
    },
  };
}

export function formatCapturedConsole(capture: CapturedConsole): string {
  return capture.all.join('\n');
}
