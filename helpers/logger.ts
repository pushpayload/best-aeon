import { config } from 'dotenv'
config()

/**
 * Enum to represent the log levels.
 * @enum {number} LogLevel
 * @readonly
 * @example
 * LogLevel.debug // 1
 * LogLevel.info // 2
 * LogLevel.warn // 3
 * LogLevel.error // 4
 */
export enum LogLevel {
  debug = 1,
  info = 2,
  warn = 3,
  error = 4,
}
/**
 * Logger class to log messages to the console. The log level can be set to control the verbosity of the logs.
 * Will insert [LOG], [DEBUG], [INFO], [WARN], or [ERROR] before the message.
 *
 * @class Logger
 * @constructor
 * @param {Object} [options] - Options for the logger.
 * @param {LogLevel} [options.logLevel=LogLevel.info] - The log level to use. Defaults to LogLevel.info.
 * @param {string} [options.functionName] - The name of the function to include in the log messages.
 * @example
 * const logger = new Logger(LogLevel.debug)
 * logger.debug('Debug message')
 * logger.info('Info message')
 * logger.warn('Warning message')
 * logger.error('Error message')
 * logger.setLogLevel(LogLevel.debug)
 */
export class Logger {
  private logLevel: LogLevel = LogLevel.info
  private functionName: string | undefined

  constructor(options?: { logLevel?: LogLevel; functionName?: string }) {
    if (options?.logLevel && options.logLevel in LogLevel) {
      this.logLevel = options.logLevel
    } else if (process.env.DEV) {
      this.logLevel = LogLevel.debug
    }
    if (options?.functionName) {
      this.functionName = options.functionName
    }
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level
  }

  getLogLevel(): LogLevel {
    return this.logLevel
  }

  setFunctionName(name: string): void {
    this.functionName = name
  }

  getFunctionName(): string | undefined {
    return this.functionName
  }

  log(...args: any[]): void {
    // Insert the function name before the message
    if (this.functionName) {
      args.unshift(`[${this.functionName}]`)
    }
    // Insert [LOG] before the message
    args.unshift('[LOG]')
    console.log(...args)
  }

  debug(...args: any[]): void {
    if (this.logLevel <= LogLevel.debug) {
      // Insert the function name before the message
      if (this.functionName) {
        args.unshift(`[${this.functionName}]`)
      }
      // Insert [DEBUG] before the message
      args.unshift('[DEBUG]')
      console.debug(...args)
    }
  }

  info(...args: any[]): void {
    if (this.logLevel <= LogLevel.info) {
      // Insert the function name before the message
      if (this.functionName) {
        args.unshift(`[${this.functionName}]`)
      }
      // Insert [INFO] before the message
      args.unshift('[INFO]')
      console.info(...args)
    }
  }

  warn(...args: any[]): void {
    if (this.logLevel <= LogLevel.warn) {
      // Insert the function name before the message
      if (this.functionName) {
        args.unshift(`[${this.functionName}]`)
      }
      // Insert [WARN] before the message
      args.unshift('[WARN]')
      console.warn(...args)
    }
  }

  error(...args: any[]): void {
    if (this.logLevel <= LogLevel.error) {
      // Insert the function name before the message
      if (this.functionName) {
        args.unshift(`[${this.functionName}]`)
      }
      // Insert [ERROR] before the message
      args.unshift('[ERROR]')
      console.error(...args)
    }
  }
}
