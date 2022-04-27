# [Clifry](https://github.com/jaunt/clifry)

#### Node.JS application for functionally testing command line applications (CLI)

## Design Philosophy

Clifry is for black-box testing command line interpreter apps (CLIs).

Its goal is to make functional testing easy by harnessing the simplicity of writing javascript. It offers a very simple workflow and API, honed for running and testing CLIs. Clifry is configuration-file-free, and wants to get out of your way.

Clifry doesn't provide much in the way of domain specific testing functionality. It's up to you to use something like the standard unix diff tool if you want to compare human-readable file outputs, or any external tool you need depending on the nature of your CLI. You can easily require npm modules of your choosing in your javascript test files, as long as they are compatible with Node.JS.

Clifry will always stay lean and minimal, by design.

Note: Clifry was created to test black-box test Airfry, a javascript static site generator. So it's battle tested in that way.

## How To Write Tests

Clifry will run tests against a CLI that you specify as an argument. You write tests as separate javascript files. Clifry will find and run through them.

A clifry test file must accept an instance of the api object, and return a promise to resolve (pass) or reject (fail) the test.

The API object passed to your test provides a minimal set of functions designed to make it easy to interact with your CLI for functional testing purposes.

Most of these functions are designed to be used with javascript's [async await mechanism](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Async_await), in order to keep the flow
of your tests clean and easy to read.

##### Example test.js file: Run python interactively to make sure it can do math!

```javascript
const test = (CliFry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = CliFry(
      {
        name: "Simple Test",
        description: "Run python, do math, exit.",
      },
      // arguments
      ["-i", "-q"]
    );

    try {
      await testRun.start(100);

      await testRun.untilStderrIncludes(">>>", 5000);

      testRun.write("10+10");

      await testRun.untilStdoutIncludes("20", 2000);

      await testRun.untilOutputIdleSeconds(1, 2000);

      testRun.write("exit()");

      await testRun.untilStopped(1000);

      resolve("success");
    } catch (error) {
      reject("Python can't do math!");
    }
  });
};

module.exports = test;
```

Hopefully the above is somewhat self explanatory.

Of course testing _stdout_ and _stderr_ is only one aspect of testing a CLI. In the case of Airfry, a static site generator, the clifry tests were written to use the unix diff command to compare site outputs at different points in time. Refer to the [Airfry test folder in git](https://github.com/jaunt/airfryts/tree/main/tests) to see how it works.

Clifry is designed so that you include the 3rd party libraries you need to test the domain specific data you are testing for within your javascript test files. You can use npm and require as you desire. Perhaps you want to compare audio or video files at each step of the test. There's probably an npm module for that!

Clifry was written in typescript and so the test API documentation has been kept that way
to show you the types of the interface. Your test files must be javascript, but if
you want to write them in typescript you could always set up a pre-compile step in your environment.

## How to run Clifry

TODO -> NPM INSTALL INSTRUCTIONS

Create a parent test folder in your project, then create a child folder for each test you want to run.

The child folder names become the test names you can run using the Clifry's -t argument.

#### Optionally call Clifry with the following arguments:

**-f, --folder**

The parent folder for all of your child test folders (defaults to ./tests)

**-t, --tests**

One or more test names (folder names). If not specified, Clifry will run all that it finds in the parent test folder.

**-c, --cli**

The path to the normal CLI you are testing

**-n, --node**

The path to the node CLI you are testing

##### You must specify either a node or a regular binary cli, but not both.

## Api

#### [Documentation](https://jaunt.github.io/clifry/classes/ClifryAPI.html)
