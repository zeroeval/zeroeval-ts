/**
 * Logger utility for ZeroEval TypeScript SDK
 * Provides colored console output when debug mode is enabled
 */

// ANSI color codes
const colors = {
  grey: '\x1b[38;5;244m',
  blue: '\x1b[34;1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  boldRed: '\x1b[31;1m',
  reset: '\x1b[0m',
};

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private name: string;
  private static globalLevel: LogLevel = LogLevel.WARN;
  private static isDebugMode: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  static setDebugMode(enabled: boolean): void {
    Logger.isDebugMode = enabled;
    Logger.globalLevel = enabled ? LogLevel.DEBUG : LogLevel.WARN;
  }

  static isDebugEnabled(): boolean {
    return Logger.isDebugMode;
  }

  private formatTimestamp(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  private formatMessage(
    level: string,
    levelColor: string,
    message: string
  ): string {
    if (!Logger.isDebugMode) {
      // In non-debug mode, use simple format without colors
      return `[${this.name}] [${level}] ${message}`;
    }

    // In debug mode, use colored format
    const timestamp = this.formatTimestamp();
    return `${colors.grey}[${timestamp}]${colors.reset} ${colors.blue}[${this.name}]${colors.reset} ${levelColor}[${level}]${colors.reset} ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (Logger.globalLevel <= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', colors.blue, message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (Logger.globalLevel <= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', colors.green, message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (Logger.globalLevel <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', colors.yellow, message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (Logger.globalLevel <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', colors.red, message), ...args);
    }
  }

  /**
   * Mask sensitive data like API keys for logging
   */
  static maskApiKey(apiKey: string | undefined): string {
    if (!apiKey) return 'Not set';
    if (apiKey.length <= 8) return '***';
    return `${apiKey.substring(0, 8)}...`;
  }
}

export function getLogger(name: string): Logger {
  return new Logger(name);
}

export { Logger };
