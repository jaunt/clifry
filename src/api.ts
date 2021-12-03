import { cwd } from "process";
import { Pinger, makeLoggers } from "./shared";
import chalk from "chalk";
const loggers = makeLoggers("# ", "!!! ", chalk.greenBright, chalk.redBright);
const log = loggers.log;
const logError = loggers.logError;
const { spawn } = require("child_process");
var emitter = require("events").EventEmitter;
const crypto = require("crypto");

/**
 * Internal state for class
 *
 * @internal
 */
type TestRunState = {
  process: any;
  output: { [key: string]: string[] };
  pinger: Pinger | null;
  secondsIdle: number;
  idleEmitter: any;
  findIndex: { [key: string]: number };
  name: string;
  description: string;
};

export class ClifryAPI {
  /**
   * The working directory of the test
   * @readonly
   */
  readonly dir: string;

  /**
   * The command used to call the cli
   *
   * @internal
   */
  readonly cmd: string;

  /**
   * Args used to call cli
   *
   * @internal
   */
  readonly args: string[];

  /**
   * Internal state for class
   *
   * @internal
   */
  private state: TestRunState;

  /**
   * Constructor
   *
   * @internal
   */
  constructor(
    cmd: string,
    cwd: string,
    name: string,
    description: string,
    args: string[]
  ) {
    this.cmd = cmd;
    this.dir = cwd;
    this.args = args;
    this.state = {
      process: null,
      output: {} as { string: string[] },
      pinger: null,
      secondsIdle: 0,
      idleEmitter: null,
      findIndex: {} as { string: number },
      name: name || "",
      description: description || "",
    };
  }

  /**
   * Clean up  timers
   *
   * @internal
   */
  private clearTimers() {
    if (this.state.pinger != null) {
      this.state.pinger.stop();
    }
  }

  /**
   * Clean up any listeners on our process
   *
   * @internal
   */
  protected _cleanupTest() {
    this.clearTimers();
    if (this.state.process && this.state.process.exitCode == null) {
      // remove all listeners and exit
      this.state.process.removeAllListeners("exit");
      this.state.process.removeAllListeners("close");
      this.state.process.removeAllListeners("sthis.state.processawn");
      this.state.process.removeAllListeners("data");
      this.state.process.kill("SIGINT");
      log("Force quitting CLI on cleanup");
    }
  }

  /**
   * Helper for runing a test against an array of output strings,
   * optimized so that we don't keep checking the entire
   * output every time.  Can be called multiple times before
   * or after a tests succeeds.
   *
   * @internal
   */
  private _untilArrayTests(
    matchTestName: string,
    type: string,
    search: string,
    test: (line: string) => boolean,
    timeout: number
  ) {
    const matchTestID = crypto.randomBytes(16).toString("hex");
    const _searchOutput = (
      search: string,
      test: (value: string) => boolean
    ) => {
      if (!this.state.findIndex[matchTestID]) {
        this.state.findIndex[matchTestID] = 0;
      }
      if (!this.state.output[type]) return;
      if (this.state.findIndex[matchTestID] == this.state.output[type].length)
        return false;
      const index = this.state.output[type]
        .slice(this.state.findIndex[matchTestID])
        .findIndex((value) => test(value));
      this.state.findIndex[matchTestID] =
        index == -1
          ? this.state.output[type].length
          : index + this.state.findIndex[matchTestID] + 1;
      return index != -1;
    };
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("Test has not started, no output to monitor.");
        resolve(0);
        return;
      }
      if (_searchOutput(search, test)) {
        log(type + " already passes " + matchTestName + " with " + search);
        resolve(true);
      } else {
        log("Waiting for " + type + " to " + matchTestName + " with " + search);
        let _timeout: NodeJS.Timeout | null = null;
        function _testOutput(data: Buffer) {
          if (_searchOutput(search, test)) {
            log("Output now passes " + matchTestName + " with " + search);
            if (_timeout != null) {
              clearTimeout(_timeout);
            }
            state.process[type].removeListener("data", _testOutput);
            resolve(true);
          }
        }
        if (timeout) {
          log("Will timeout in " + timeout + " ms");
          _timeout = setTimeout(() => {
            log(
              "Timed out waiting for " +
                type +
                " to pass " +
                matchTestName +
                " with " +
                search
            );
            state.process[type].removeListener("data", _testOutput);
            resolve(false);
          }, timeout);
        }
        state.process[type].on("data", _testOutput);
      }
    });
  }

  /**
   * Check if process has started and is running
   *
   * @internal
   */
  private isRunning(process: any) {
    return process && process.exitCode == null;
  }

  /**
   * Check if process has started and has stopped
   *
   * @internal
   */
  private hasStopped(process: any) {
    return process && process.exitCode != null;
  }

  /**
   * Starts the CLI being tested
   *
   * @param [timeout] Timeout ms while waiting for the CLI to start.
   *
   * @returns A promise that will resolve 'true' when the cli starts, or 'false' if it fails to do so before the timeout specified..
   *
   */
  start(timeout: number = 0) {
    if (this.isRunning(this.state.process)) {
      logError(
        "CLI Already started.  Use forceStop or wait until the process ends."
      );
      return;
    }
    let state = this.state;
    const cmd = this.cmd;
    const args = this.args;
    const clearTimers = this.clearTimers;
    return new Promise(function (resolve) {
      log("Starting: " + cmd + " in " + cwd);
      let _timeout: NodeJS.Timeout | null = null;
      if (timeout) {
        log("Will timeout in " + timeout + " ms");
        _timeout = setTimeout(() => {
          log("Timed out waiting to spawn.");
          resolve(false);
        }, timeout);
      }
      try {
        state.process = spawn(cmd, [...args], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: cwd,
        });
      } catch (error) {
        resolve(false);
      }
      state.process.on("spawn", () => {
        log("CLI Started");
        state.idleEmitter = new emitter();
        state.pinger = new Pinger(
          "idleTimer",
          (id: string) => {
            state.secondsIdle++;
            state.idleEmitter.emit("tick", state.secondsIdle);
          },
          1000
        );
        if (_timeout != null) {
          clearTimeout(_timeout);
        }
        resolve(true);
      });
      state.process.stdout.on("data", (data: Buffer) => {
        if (!state.output["stdout"]) {
          state.output["stdout"] = [];
        }
        state.output["stdout"].push(data.toString());
        state.secondsIdle = 0;
      });
      state.process.stderr.on("data", (data: Buffer) => {
        if (!state.output["stderr"]) {
          state.output["stderr"] = [];
        }
        state.output["stderr"].push(data.toString());
        state.secondsIdle = 0;
      });
      state.process.on("close", (code: number, signal: string) => {
        if (code) {
          log(`child process closed with code ${code}`);
        }
        if (signal) {
          log(`child process terminated due to receipt of signal ${signal}`);
        }
      });
      state.process.on("exit", (code: number) => {
        clearTimers();
        if (code) {
          log(`child process exited with code ${code}`);
        }
      });
    });
  }

  /**
   * Writes a line to stdin of the CLI being tested.
   *
   * * @param txt the text to write to stdin, no need for newline or carriage return
   *
   */
  write(txt: string) {
    this.state.process.stdin.write(txt + "\r\n");
  }

  /**
   * Waits until the CLI stops on its own, or is already stopped.
   *
   * @param [timeout] Timeout ms while waiting for the CLI to be stopped.
   *
   * @returns A promise that will resolve with the CLI's exit code, or 124 if it timed out shutting down.
   *
   */
  untilStopped(timeout: number = 0) {
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("CLI has not started.");
        resolve(0);
      } else if (state.process.exitCode != null) {
        log("CLI is already stopped");
        resolve(state.process.exitCode);
      } else {
        log("Waiting for CLI to stop on its own.");
        let _timeout: NodeJS.Timeout | null = null;
        function _stopListener() {
          log("CLI stopped on its own.");
          if (_timeout != null) {
            clearTimeout(_timeout);
          }
          state.process.removeListener("exit", _stopListener);
          resolve(state.process.exitCode);
        }
        if (timeout) {
          log("Will timeout in " + timeout + " ms");
          _timeout = setTimeout(() => {
            log("Timed out waiting to stop.");
            state.process.removeListener("exit", _stopListener);
            resolve(124);
          }, timeout);
        }
        state.process.on("exit", _stopListener);
      }
    });
  }

  /**
   * Gets an array of the entire stdout so far.
   *
   *
   * @returns An array of lines that have been outputted to stdout
   *
   */
  getStdout(): string[] {
    return [...this.state.output["stdout"]];
  }

  /**
   * Gets an array of the entire stderr so far.
   *
   *
   * @returns An array of lines that have been outputted to stdout
   *
   */
  getStderr(): string[] {
    return [...this.state.output["stderr"]];
  }

  /**
   * Sends SIGINT to the CLI.
   */
  forceStop() {
    if (this.state.process && this.state.process.exitCode == null) {
      log("Passing SIGINT to process");
      this.state.process.kill("SIGINT");
    } else {
      logError("CLI not running, nothing to force stop");
    }
  }
  /**
   * Writes a log message to Clifry's console log output.
   *
   * @remarks
   *
   * Monitoring Clifry's log is how you see information during the testing process.
   * This function allows for custom information to be printed during your tests.
   *
   * @param message The message to print.
   *
   */
  log(message: string) {
    log("(" + this.state.name + ") " + message);
  }
  /**
   * Writes a log message to Clifry's console error output.
   *
   * @remarks
   *
   * Monitoring Clifry's error log to see information about problems during a test.
   * This allows function allows for custom error information to be printed during your tests.
   *
   * @param message The error message to print.
   *
   */
  error(message: string) {
    logError("(" + this.state.name + ") " + message);
  }
  /**
   * Do nothing for a period of time in case you need to wait for the CLI to process.
   *
   * @param ms The number of ms to sleep for.
   *
   * @returns A promise that will resolve when the sleep is over.
   *
   */
  sleep(ms: number) {
    log("Sleeping for " + ms + "ms");
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Wait until the stdout and stderr have been quiet for N seconds.
   *
   * @param seconds The desired number of seconds of idle time
   * @param [timeout] Timeout ms while waiting for the CLI to be stopped.
   *
   * @returns A promise that will resolve true if the CLI becomes idle for the desired time, false if it times out first.
   *
   */
  untilOutputIdleSeconds(seconds: Number, timeout: number = 0) {
    // wait number of seconds since last stdout or stderr
    this.state.secondsIdle = 0;
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("Test has not started, nothing to wait for.");
        resolve(0);
        return;
      }
      if (state.secondsIdle >= seconds) {
        log("Output has already been idle for " + seconds + " seconds.");
        resolve(state.secondsIdle);
      } else {
        log("Waiting for idle seconds " + seconds);
        let _timeout: NodeJS.Timeout | null = null;
        function idleChecker(s: number) {
          if (s >= seconds) {
            if (_timeout != null) {
              clearTimeout(_timeout);
            }
            log("Output has been idle for " + s + " seconds.");
            resolve(true);
          }
        }
        if (timeout) {
          log("Will timeout in " + timeout + " ms");
          _timeout = setTimeout(() => {
            log("Timed out waiting to stop.");
            state.idleEmitter.removeListener("tick", idleChecker);
            resolve(false);
          }, timeout);
        }
        state.idleEmitter.on("tick", idleChecker);
      }
    });
  }
  /**
   * Wait until a line of stdout includes the search string (using javascript string.includes)
   *
   * @remarks
   *
   * Example:
   * If you wanted to wait until your CLI outputted: "At 10:23am, the CLI completed job #124789124987,
   * but you only cared about a portion of that line, you could call:
   * await untilStdoutIncludes("the CLI completed job")
   *
   * @param search The string you'd like the output to include.
   * @param [timeout] Timeout ms while waiting for the CLI to be stopped.
   *
   * @returns a promise that will resolve true if a match is found or false if it times out first.
   *
   */
  untilStdoutIncludes(search: string, timeout: number = 0) {
    return this._untilArrayTests(
      "includes",
      "stdout",
      search,
      (value: string) => value.includes(search),
      timeout
    );
  }
  /**
	 * Wait until a line of stderr includes the search string (using javascript string.includes)
	 *
	 * @remarks
	 *
	 * Example:
	 * If you wanted to wait until your CLI outputted: "At 10:23am, the CLI completed job #124789124987,
	 * but you only cared about a portion of that line, you could call:
	 * await untilStdoutIncludes("the CLI completed job")
	 *
	 * @param search The string you'd like the output to include.
	 * @param [timeout] Timeout ms while waiting for the CLI to be stopped.

	 *
	 * @returns a promise that will resolve true if a match is found or false if it times out first.
	 *
	 */
  untilStderrIncludes(search: string, timeout: number = 0) {
    return this._untilArrayTests(
      "includes",
      "stderr",
      search,
      (line: string) => line.includes(search),
      timeout
    );
  }
  /**
	 * Wait until a line of stdout matches exactly search string
	 *
	 * @param search The string you'd like the output match exactly.
	 * @param [timeout] Timeout ms while waiting for the CLI to be stopped.

	 *
	 * @returns a promise that will resolve true if a match is found or false if it times out first.
	 *
	 */
  untilStdoutEquals(search: string, timeout: number = 0) {
    return this._untilArrayTests(
      "equals",
      "stdout",
      search,
      (line: string) => line === search,
      timeout
    );
  }
  /**
	 * Wait until a line of stderr matches exactly search string
	 *
	 * @param search The string you'd like the output to match exactly.
	 * @param [timeout] Timeout ms while waiting for the CLI to be stopped.

	 *
	 * @returns a promise that will resolve true if a match is found or false if it times out first.
	 *
	 */
  untilStderrEquals(search: string, timeout: number = 0) {
    return this._untilArrayTests(
      "equals",
      "stderr",
      search,
      (line: string) => line === search,
      timeout
    );
  }
  /**
   * Wait until a line of stdout passes the supplied test.
   *
   * @param matchTestName a name describing your test func which is printed in the Clifry test log.
   * @param search The string you'd like the output to match exactly.
   * @param test This will be called for every output with the value of the line.  Return true if it passes your test.
   * @param [timeout] Timeout ms while waiting for the CLI to be stopped.
   *
   * @returns a promise that will resolve true if your test is passed, or false if it times out first.
   *
   */
  untilStdoutPasses(
    matchTestName: string,
    search: string,
    test: (line: string) => boolean,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      matchTestName,
      "stdout",
      search,
      test,
      timeout
    );
  }
  /**
   * Wait until a line of stderr passes the supplied test.
   *
   * @param matchTestName a name describing your test func which is printed in the Clifry test log.
   * @param search The string you'd like the output to match exactly.
   * @param test This will be called for every output with the value of the line.  Return true if it passes your test.
   * @param [timeout] Timeout ms while waiting for the CLI to be stopped.
   *
   * @returns a promise that will resolve true if your test is passed, or false if it times out first.
   *
   */
  untilStderrPasses(
    matchTestName: string,
    search: string,
    test: (line: string) => boolean,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      matchTestName,
      "stderr",
      search,
      test,
      timeout
    );
  }
}
