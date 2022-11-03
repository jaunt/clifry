import { Pinger, makeLoggers } from "@danglingdev/shared-ts";
import pico from "picocolors";
const loggers = makeLoggers("# ", "!!! ", pico.green, pico.red);
const log = loggers.log;
const logError = loggers.logError;
const { spawn } = require("child_process");
var emitter = require("events").EventEmitter;
const readline = require("readline");

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
   * The working directory of the test.  Use this if you are loading or storing files as a part of your test.
   * @readonly
   */
  readonly dir: string;

  /**
   * The command used to call your CLI.
   *
   * @internal
   */
  readonly cmd: string;

  /**
   * The args used to call your CLI.
   *
   * @internal
   */
  readonly args: string[];

  /**
   * Internal state for class.
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
   * Clean up timers.
   *
   * @internal
   */
  private clearTimers() {
    if (this.state.pinger != null) {
      this.state.pinger.stop();
    }
  }

  /**
   * Clean up any listeners on our process.
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
    testID: string,
    description: string,
    type: string,
    test: (line: string) => boolean,
    backtrack: boolean,
    timeout: number
  ) {
    if (!backtrack) {
      // start from now unless backtrack is set
      if (this.state.output[type]) {
        this.state.findIndex[testID] = this.state.output[type].length;
      }
    }
    const _searchOutput = (test: (value: string) => boolean) => {
      if (!this.state.findIndex[testID]) {
        this.state.findIndex[testID] = 0;
      }
      if (!this.state.output[type]) return;
      if (this.state.findIndex[testID] == this.state.output[type].length)
        return false;
      const index = this.state.output[type]
        .slice(this.state.findIndex[testID])
        .findIndex((value) => test(value));
      this.state.findIndex[testID] =
        index == -1
          ? this.state.output[type].length
          : index + this.state.findIndex[testID] + 1;
      return index != -1;
    };
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("You CLI has not started, cannot run " + description);
        throw new Error("failed");
      }
      if (_searchOutput(test)) {
        log(type + " already passes " + description);
        resolve(true);
      } else {
        log("Waiting for " + type + " to " + description);
        let _timeout: NodeJS.Timeout | null = null;
        function _testOutput(data: Buffer) {
          if (_searchOutput(test)) {
            log("Output now passes " + description);
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
            logError(
              "Timed out waiting for " + type + " to pass " + description
            );
            state.process[type].removeListener("data", _testOutput);
            throw new Error("failed");
          }, timeout);
        }
        state.process[type].on("data", _testOutput);
      }
    });
  }

  /**
   * Check if your CLI process has started and is running.
   *
   * @internal
   */
  private isRunning(process: any) {
    return process && process.exitCode == null;
  }

  /**
   * Check if your CLI process has started and has subsequently stopped.
   *
   * @internal
   */
  private hasStopped(process: any) {
    return process && process.exitCode != null;
  }

  /**
   * Starts your CLI process and begins the test.
   *
   * @param timeout  Optional:  Max time to wait for your CLI to start (ms).
   *
   * @returns A promise that will resolve **true** when your CLI starts, or will throw an error on timeout.
   *
   */
  start(timeout: number = 0) {
    if (this.isRunning(this.state.process)) {
      logError(
        "CLI Already started.  Use forceStop or wait until the process ends."
      );
      throw new Error("failed");
    }
    let state = this.state;
    const cmd = this.cmd;
    const cwd = this.dir;
    const args = this.args;
    const clearTimers = this.clearTimers.bind(this);
    return new Promise(function (resolve) {
      log("Starting: " + cmd + " in " + cwd);
      let _timeout: NodeJS.Timeout | null = null;
      if (timeout) {
        log("Will timeout in " + timeout + " ms");
        _timeout = setTimeout(() => {
          logError("Timed out waiting to spawn.");
          throw new Error("failed");
        }, timeout);
      }
      try {
        state.process = spawn(cmd, [...args], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: cwd,
        });
      } catch (error) {
        logError(error);
        throw new Error("failed");
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
        log("stdout: " + data.toString());
        state.output["stdout"].push(data.toString());
        state.secondsIdle = 0;
      });
      state.process.stderr.on("data", (data: Buffer) => {
        if (!state.output["stderr"]) {
          state.output["stderr"] = [];
        }
        log("stderr: " + data.toString());
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
   * Writes a line to your CLI's stdin.
   *
   * * @param txt the text to write to stdin (no need for newline or carriage return).
   *
   */
  write(txt: string) {
    this.state.process.stdin.write(txt + "\r\n");
  }

  /**
   * Waits until your CLI stops on its own, or is already stopped.
   *
   * @param timeout  Optional:  Max time to wait for your CLI to stop on its own (ms).
   *
   * @returns A promise that will resolve with the CLI's exit code, or will throw an error on timeout.
   *
   */
  untilStopped(timeout: number = 0) {
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("CLI has not started.");
        throw new Error("failed");
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
            throw new Error("failed");
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
   * Sends SIGINT to your CLI.
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
   * Writes a message to Clifry's console log output.
   *
   * @remarks
   *
   * You can monitor Clifry's test log to help debug problems during your test.
   *
   * @param message The message to print.
   *
   */
  log(message: string) {
    log("(" + this.state.name + ") " + message);
  }
  /**
   * Writes an error log message to Clifry's console output.
   *
   * @remarks
   *
   * You can monitor Clifry's test log to help debug problems during your test.
   *
   * @param message The error message to print.
   *
   */
  error(message: string) {
    logError("(" + this.state.name + ") " + message);
  }
  /**
   * Do nothing for a period of time in case you need to wait for your CLI.
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
   * Pause the test and read a line from the console.
   *
   * @param message The message to promt during the test.
   *
   * @returns Whatever was typed in the console.
   *
   */
  readline(message: string) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) =>
      rl.question(message, (ans: string) => {
        rl.close();
        resolve(ans);
      })
    );
  }
  /**
   * Wait until your CLI's stdout and stderr have been quiet for N seconds.
   *
   * @param seconds The desired number of seconds of idle time.
   * @param timeout  Optional:  Max time to wait for your CLI to become idle (ms).
   *
   * @returns A promise that will resolve **true** if the CLI becomes idle for the desired time, or will throw an error on timeout.
   *
   */
  untilOutputIdleSeconds(seconds: Number, timeout: number = 0) {
    // wait number of seconds since last stdout or stderr
    this.state.secondsIdle = 0;
    const state = this.state;
    return new Promise(function (resolve) {
      if (!state.process) {
        logError("Test has not started, nothing to wait for.");
        throw new Error("failed");
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
            log(
              "Output has been idle for " + s + " seconds. (" + seconds + ")"
            );
            state.idleEmitter.removeListener("tick", idleChecker);
            resolve(true);
          }
        }
        if (timeout) {
          log("Will timeout in " + timeout + " ms");
          _timeout = setTimeout(() => {
            logError("Timed out waiting to stop.");
            state.idleEmitter.removeListener("tick", idleChecker);
            throw new Error("failed");
          }, timeout);
        }
        state.idleEmitter.on("tick", idleChecker);
      }
    });
  }
  /**
   * Wait until a line of stdout includes the search string (using javascript string.includes).
   *
   * @remarks
   *
   * Example:
   * If you wanted to wait until your CLI outputted: "At 10:23am, the CLI completed job #124789124987,
   * but you only cared about a portion of that line, using a search parameter of "the CLI completed job"
   * would return true.
   *
   * @param search The string you'd like the output to include.
   * @param backtrack Optional:  Test includes output since last call to test.
   * @param timeout  Optional:  Max time to wait for a match (ms).
   *
   * @returns a promise that will resolve **true** if a match is found, or will throw an error on timeout.
   *
   */
  untilStdoutIncludes(
    search: string,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      "includes_" + search,
      "includes '" + search + "'",
      "stdout",
      (value: string) => value.includes(search),
      backtrack,
      timeout
    );
  }
  /**
	 * Wait until a line of stderr includes the search string (using javascript string.includes)
	 *
	 * @remarks
	 *
	 * See {@link untilStdoutIncludes} for example usage.
	 *
	 * @param search The string you'd like the output to include.
   * @param backtrack Optional:  Test includes output since last call to test.
	 * @param timeout  Optional:  Max time to wait for a match (ms).

	 *
	 * @returns a promise that will resolve **true** if a match is found, or will throw an error on timeout.
	 *
	 */
  untilStderrIncludes(
    search: string,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      "includes_" + search,
      "includes '" + search + "'",
      "stderr",
      (line: string) => line.includes(search),
      backtrack,
      timeout
    );
  }
  /**
	 * Wait until a line of stdout matches your search string exactly.
	 *
	 * @param search The string you'd like stdout to match exactly.
   * @param backtrack Optional:  Test includes output since last call to test.
	 * @param timeout  Optional:  Max time to wait for a match (ms).

	 *
	 * @returns a promise that will resolve true if a match is found, or will throw an error on timeout.
	 *
	 */
  untilStdoutEquals(
    search: string,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      "equals_" + search,
      "equals '" + search + "'",
      "stdout",
      (line: string) => line === search,
      backtrack,
      timeout
    );
  }
  /**
	 * Wait until a line of stderr matches your search string exactly.
	 *
	 * @param search The string you'd like stderr to match exactly.
   * @param backtrack Optional:  Test includes output since last call to test.
	 * @param timeout  Optional:  Max time to wait for a match (ms).

	 *
	 * @returns a promise that will resolve true if a match is found, or will throw an error on timeout..
	 *
	 */
  untilStderrEquals(
    search: string,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      "equals_" + search,
      "equals '" + search + "'",
      "stderr",
      (line: string) => line === search,
      backtrack,
      timeout
    );
  }
  /**
   * Wait until a line of your CLI's stdout passes your supplied matching function.
   *
   * @param uniqueID This is required to enable calling your test multiple times throughout the course of a test.
   * @param logMessage This will be printed in CliFry's log and should be short but descriptive, so that you can see clearly when your function passed or failed.
   * @param matchFunc This will be called for every line of your CLI's output.  Return true if the line was matched by your function.
   * @param backtrack Optional:  Test includes output since last call to test.
   * @param timeout  Optional:  Max time to wait for a pass (ms).
   *
   * @remarks
   *
   * uniqueID is used as an index any time you re-search with the same function.
   * For example if you search and find something, then later you want to find something again, using the
   * same uniqueID will tell Clifry that you want to start where the previous search left off rather than starting again from the beginning of the entire output.
   *
   * @returns a promise that will resolve **true** if your test is passed, or will throw an error on timeout.
   *
   */
  untilStdoutPasses(
    uniqueID: string,
    logMessage: string,
    test: (line: string) => boolean,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      uniqueID,
      logMessage,
      "stdout",
      test,
      backtrack,
      timeout
    );
  }
  /**
   * Wait until a line of your CLI's stderr passes your supplied matching function.
   *
   * @param uniqueID This is required to enable calling your test multiple times throughout the course of a test.
   * @param logMessage This will be printed in CliFry's log and should be short but descriptive, so that you can see clearly when your function passed or failed.
   * @param matchFunc This will be called for every line of your CLI's output.  Return true if the line was matched by your function.
   * @param backtrack Optional:  Test includes output since last call to test.
   * @param timeout  Optional:  Max time to wait for a match (ms).
   *
   * @remarks
   *
   * See {@link untilStdoutPasses} for example isage.
   *
   * @returns a promise that will resolve **true** if your test is passed, or will throw an error on timeout.
   *
   */
  untilStderrPasses(
    uniqueID: string,
    logMessage: string,
    test: (line: string) => boolean,
    backtrack: boolean = false,
    timeout: number = 0
  ) {
    return this._untilArrayTests(
      uniqueID,
      logMessage,
      "stderr",
      test,
      backtrack,
      timeout
    );
  }
}
