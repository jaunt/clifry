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
