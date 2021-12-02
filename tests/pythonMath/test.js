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

    await testRun.untilStderrIncludes(">>>", 5000);

    testRun.write("10+10");

    const result = await testRun.untilStdoutIncludes("20", 2000);

    testRun.waitUntilOutputIdleSeconds(1, 2000);

    testRun.write("exit()");

    await testRun.stopped(1000);

    if (!result) {
      reject("10 + 10 does not equal 21");
    } else {
      resolve("success");
    }
  });
};

module.exports = test;
