# [Clifry](https://github.com/jaunt/clifry)

#### CLI Functional Testing tool powered by Node.JS

## Design Philosophy

Clifry is for black-box testing command line interpreter apps (CLIs).

It's goal is to harness the simplicity of writing javascript offering a very simple workflow and API, honed for running and testing CLIs. Clifry is configuration 'light' and wants to get out of your way.

Clifry doesn't provide much in the way of domain specific testing functionality. It's up to you to use something like the standard unix diff tool if you want to compare human-readable file outputs, or any external tool you need depending on the nature of your CLI. You can easily require npm modules of your choosing in your javascript test files, as long as they are compatible with Node.JS.

Clifry will always stay lean and minimal, by design.

Note: Clifry was created to test black-box test Airfry, a javascript static site generator. So it's battle tested in that way.

## How To Write Tests

Clifry will run tests against a CLI that you specify as an argument. You write tests separate javascript files which Clifry will find and run through.

A clifry test file must accept an instance of the api object, and return a promise to resolve (pass) or reject (fail) the test.

The API object passed to your test provides a minimal set of functions designed to make it easy to interact with your CLI for functional testing purposes.

Most of these functions are designed to be used with javascript's [async await mechanism.](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Async_await), in order to keep the flow
of your tests clean and easy to read.

##### Example test.js file: run python interactively to make sure it can do math

```javascript
const timeout = 5000;
const test = (CliFry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = CliFry(
      {
        name: "Simple Test",
        description: "Run python, do some math, exit.",
      },
      // arguments
      ["-i", "-q"]
    );
    testRun.start();

    let success;

    success = await testRun.untilStderrIncludes(">>>", timeout);

    if (!success) {
      reject("Did not get python prompt");
      return;
    }

    testRun.write("10+10");

    success = await testRun.untilStdoutIncludes("20", 2000);

    if (!success) {
      reject("Python does not know math.");
    }

    testRun.write("exit()");

    success = await testRun.stopped(timeout);

    if (!success) {
      reject("Python would not shutdown gracefully");
    } else {
      resolve("Python is great!");
    }
  });
};
module.exports = test;
```

Hopefully the above is somewhat self explanitory.

Of course testing _stdout_ and _stderr_ is only one aspect of testing a CLI. In the case of Airfry, a static site generator, the clifry tests were written to use the unix diff command to compare site outputs at different stages. Refer to the [Airfry test folder in git](https://github.com/jaunt/airfryts/tree/main/tests) to see how it works.

Clifry is designed so that you include anything you need to test the domain specific data you are testing for within your javascript test files. You can use npm and require as you desire. Perhaps you want to compare audio or video files at each step of the test. There's probably an npm module for that!

Clifry was written in typescript and so the test API documentation has been kept that way
to easily show you the types of the interface. Your test files must be javascript, but if
you want to write them in typescript you could always set that up in your test environment.

## How to run Clifry

Create a parent test folder in your project, then a child folder for each test you want to run.
The child folder names become the test names you can run using the -t argument to Clifry.

Call Clifry with the following arguments:

**-f, --folder**

The parent folder the Clifry will look for your tests (defaults to ./tests)

**-t, --tests**

One or more test names (folder names). If not specified, Clifry will run all that it finds.

**-c, --cli**

The path to the CLI you are testing (defaults to ./lib/cli.js)

## Api

####[Documentation](https://jaunt.github.io/clifry/classes/ClifryAPI.html)
