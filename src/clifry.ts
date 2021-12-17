#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import fspath from "path";
import { makeLoggers } from "@danglingdev/shared-ts";
import { exit } from "process";

import { ClifryAPI } from "./api";

import { LIB_VERSION } from "./version";

console.log(chalk.black.bgWhite.bold("\n CLI", chalk.white.bgBlue(" FRY ")));
console.log(chalk.blueBright("Version " + LIB_VERSION + "\n"));

const loggers = makeLoggers("# ", "!!! ", chalk.green, chalk.red);
const log = loggers.log;
const logError = loggers.logError;

const program = new Command()
  .option("-t, --tests [tests...]", "Test name or names.  Default is run all.")
  .option(
    "-f, --folder <folder>",
    "tests parent folder (default = ./tests)",
    "./tests"
  )
  .option("-c, --cli <path>", "path to cli to test")
  .option("-n, --node <script>", "if cli is a node script");

program.version(LIB_VERSION);
program.parse(process.argv);
const options = program.opts();

const findAllTests = function (dirPath: string): string[] {
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

if (!options.cli && !options.node) {
  logError("Must specify either a cli or a node script.");
  exit();
}
if (options.cli && options.node) {
  logError("Must specify either a cli or a node script, not both.");
  exit();
}

let cmd: string = "";
let script: string = "";
if (options.cli) {
  cmd = options.cli;
}
if (options.node) {
  cmd = process.execPath;
  script = options.node;
}

class ClifryAPIWrapper extends ClifryAPI {
  cleanup() {
    super._cleanupTest();
  }
}

const runTest = (testName: string): Promise<string> => {
  return new Promise(async function (resolve, reject) {
    const testDir = fspath.resolve(options.folder + "/" + testName);
    let testModule = fspath.resolve(testDir + "/" + "test.js");
    const cwd = fspath.resolve(options.folder + "/" + testName);
    let api: ClifryAPIWrapper;
    try {
      const imported = await import(testModule);
      const test = imported.default;
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
          let _args: string[] = [];
          if (script) {
            _args.push(fspath.resolve(script));
          }
          _args.push(...args);
          log(_args);
          api = new ClifryAPIWrapper(
            cmd,
            cwd,
            attr.name,
            attr.description,
            _args
          );
          return api;
        }
      );
      api!.cleanup();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
};

let results: { name: string; passed: boolean; message: string }[] = [];

let failed = false;

const runTests = async () => {
  for (const name of tests) {
    try {
      let result = await runTest(name);
      log("Test Resolved With:", result);
      results.push({
        name: name,
        passed: true,
        message: result,
      });
    } catch (result) {
      failed = true;
      logError("Test Rejected With:", result as string);
      results.push({
        name: name,
        passed: false,
        message: result as string,
      });
    }
  });

  log("\n\nTesting summary:");
  if (failed) {
    log(chalk.red(JSON.stringify(results, null, "\t")));
  } else {
    log(chalk.green(JSON.stringify(results, null, "\t")));
  }
  if (failed) {
    exit(1);
  } else {
    exit(0);
  }
};

runTests();
