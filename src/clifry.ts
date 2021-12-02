#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import fspath from "path";
const { spawn } = require("child_process");

import { Pinger, makeLoggers } from "./shared";
import { exit } from "process";
import { triggerAsyncId } from "async_hooks";

var emitter = require("events").EventEmitter;

const version = "0.0.1"; // todo get version from git tag

console.log(chalk.black.bgWhite.bold("\n CLI", chalk.white.bgBlue(" FRY ")));
console.log(chalk.blueBright("Version " + version + "\n"));

const loggers = makeLoggers("# ", "!!! ", chalk.greenBright, chalk.redBright);
const log = loggers.log;
const logError = loggers.logError;

const program = new Command()
  .option("-t, --tests [tests...]", "Test name or names.  Default is run all.")
  .option(
    "-f, --folder <folder>",
    "tests parent folder (default = ./tests)",
    "./tests"
  )
  .option(
    "-c, --cli <path>",
    "path to cli to test (default = ./lib/cli.js)",
    "./lib/cli.js"
  );

program.version(version);
program.parse(process.argv);
const options = program.opts();

const findAllTests = function (dirPath: string): string[] {
  // tests are any folders under the test directory
  const found: string[] = [];
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(function (file) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        found.push(file);
      }
    });
  } catch (error) {
    logError("Error finding tests.", error);
  }
  return found;
};

let tests: string[];
if (options.tests) {
  tests = options.tests;
} else {
  tests = findAllTests(options.folder);
}

if (!tests) {
  log("No tests found");
  exit();
}

const clearTimers = (state: any) => {
  if (state.timeout) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }
  if (state.pinger != null) {
    state.pinger.stop();
  }
};

const cleanupTest = (state: any) => {
  clearTimers(state);
  if (state.process && state.process.exitCode == null) {
    // remove all listeners and exit
    state.process.removeAllListeners("exit");
    state.process.removeAllListeners("close");
    state.process.removeAllListeners("sstate.processawn");
    state.process.removeAllListeners("data");
    state.process.kill("SIGINT");
    log("Force quitting CLI on cleanup");
  }
};

const runTest = (testName: string) => {
  return new Promise(async function (resolve, reject) {
    const testDir = fspath.resolve(options.folder + "/" + testName);
    let testModule = fspath.resolve(testDir + "/" + "test.js");
    const cmd = fspath.resolve(options.cli);
    const cwd = fspath.resolve(options.folder + "/" + testName);
    let testState: any;
    try {
      const imported = await import(testModule);
      const test = imported.default;
      type TesterState = {
        process: any;
        output: { [key: string]: string[] };
        pinger: Pinger | null;
        secondsIdle: number;
        idleEmitter: any;
        findIndex: { [key: string]: number };
        name: string;
        description: string;
        result: string | null;
      };
      const result = await test(
        (
          attr: {
            name: string;
            description: string;
            args: string[];
          },
          args: string[]
        ) => {
          log("Test: " + attr.name);
          log("Description: " + attr.description);
          const state: TesterState = {
            process: null,
            output: {} as { string: string[] },
            pinger: null,
            secondsIdle: 0,
            idleEmitter: null,
            findIndex: {} as { string: number },
            name: attr.name || "",
            description: attr.name || "",
            result: null,
          };

          const _untilArrayIncludes = (
            type: string,
            search: string,
            timeout: number
          ) => {
            // optimized so that we don't keep checking the entire
            // recorded output every time.  Can be called multiple times before
            // or after a search string is found.  to find the next time the
            // search occurs
            const _outIncludes = (search: string) => {
              if (!state.findIndex[search]) {
                state.findIndex[search] = 0;
              }
              if (!state.output[type]) return;
              if (state.findIndex[search] == state.output[type].length)
                return false;
              const index = state.output[type]
                .slice(state.findIndex[search])
                .findIndex((value) => value.includes(search));
              state.findIndex[search] =
                index == -1
                  ? state.output[type].length
                  : index + state.findIndex[search] + 1;
              return index != -1;
            };
            return new Promise(function (resolve, reject) {
              if (!state.process) {
                logError("Test has not started, no output to monitor.");
                resolve(0);
                return;
              }
              if (_outIncludes(search)) {
                log(type + " already includes " + search);
                resolve(true);
              } else {
                log("Waiting for " + type + " to include: " + search);
                let _timeout: NodeJS.Timeout | null = null;
                function _testOutput(data: Buffer) {
                  if (_outIncludes(search)) {
                    log("Output now includes " + search);
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
                    log("Timed out waiting for " + type + " to be " + search);
                    state.process[type].removeListener("data", _testOutput);
                    resolve(false);
                  }, timeout);
                }
                state.process[type].on("data", _testOutput);
              }
            });
          };

          testState = state;
          const api = {
            dir: cwd,
            start: () => {
              if (state.process && state.process.exitCode == null) {
                logError(
                  "CLI Already started.  Use forceStop or wait until the process ends."
                );
                return;
              }
              log("Starting: " + cmd + " in " + cwd);
              state.process = spawn(cmd, [...args], {
                stdio: ["pipe", "pipe", "pipe"],
                cwd: cwd,
              });
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
                  log(
                    `child process terminated due to receipt of signal ${signal}`
                  );
                }
              });
              state.process.on("exit", (code: number) => {
                clearTimers(state);
                if (code) {
                  log(`child process exited with code ${code}`);
                }
              });
            },
            write: (txt: string) => {
              state.process.stdin.write(txt + "\r\n");
            },
            stopped: (timeout: number) => {
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
            },
            forceStop: () => {
              if (state.process && state.process.exitCode == null) {
                log("Passing SIGINT to process");
                state.process.kill("SIGINT");
              } else {
                logError("CLI not running, nothing to force stop");
              }
            },
            log: (message: string) => {
              log("(" + state.name + ") " + message);
            },
            error: (message: string) => {
              logError("(" + state.name + ") " + message);
            },
            sleep: (ms: number) => {
              log("Sleeping for " + ms + "ms");
              return new Promise((resolve) => setTimeout(resolve, ms));
            },
            waitUntilStdIdleSeconds: (seconds: Number, timeout: number) => {
              // wait number of seconds since last stdout or stderr
              state.secondsIdle = 0;
              return new Promise(function (resolve) {
                if (!state.process) {
                  logError("Test has not started, nothing to wait for.");
                  resolve(0);
                  return;
                }
                if (state.secondsIdle >= seconds) {
                  log(
                    "Output has already been idle for " + seconds + " seconds."
                  );
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
            },
            untilStdoutIncludes: (search: string, timeout: number = 0) => {
              return _untilArrayIncludes("stdout", search, timeout);
            },
            untilStderrIncludes: (search: string, timeout: number = 0) => {
              return _untilArrayIncludes("stderr", search, timeout);
            },
          };
          return api;
        }
      );
      testState.result = result;
      resolve(testState);
    } catch (error) {
      if (!testState) {
        testState = {};
      }
      testState.result = error;
      reject(testState);
    }
  });
};

tests.forEach((testName: string) => {
  runTest(testName)
    .then((testState: any) => {
      cleanupTest(testState);
      log("Test Resolved With:", testState.result);
    })
    .catch((testState: any) => {
      cleanupTest(testState);
      logError("Test Rejected With:", testState.result);
    });
});
