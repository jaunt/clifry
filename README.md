# Clifry

#### CLI Functional Testing tool powered by Node.JS

## Design Philosophy

This tool allows a way to black-box test a command line app by writing simple javascript code.

Instead of having to learn how to configure a taskrunner tool like grunt or gulp, the idea is to write simple javascript code with a very simple API related to running CLIs.

It's up to you to use something like the standard unix dif tool or any node js module of your choosing to compare whatever your CLI creates, or if you're more interested in
what it spits out to stdio or stder, you can use simple javascript to compare
what you expected to what you saw.

Clifry was made to test black-box-test Airfy, a javascript static site generator.

## Quickstart

Clifry will run tests against a CLI that you specify as an argument. You write each test in its own javascript file.

A clifry test accepts an instance of the api object, and returns a promise to resolve (pass) or reject (fail) the test.

The API object passed to your test provides a minimal set of functions designed to make it easy to interact with your CLI for functional testing purposes.

Most of these functions are designed to be used with javascript's [async await mechanism.](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Async_await)

##### Example: run python interactively to make sure it can do math

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

Clifry is designed so that you include anything you need to test the domain specific data you are testing for within your javascript test files. You can use npm and require as you desire. Perhaps you want to compare audio or video files at each step of the test. There's probably an NPM for that!

## API

[Read the docs, created by Airfry](https://dangling.dev/airfry)
