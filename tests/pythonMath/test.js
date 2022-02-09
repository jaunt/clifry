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

      await testRun.untilStderrIncludes(">>>");

      testRun.write("10+10");

      await testRun.untilStdoutIncludes("20");

      await testRun.untilOutputIdleSeconds(1, 2000);

      const answer = await testRun.readline("What is 10+10?");

      testRun.write(answer);

      testRun.write("exit()");

      await testRun.untilStopped(1000);

      resolve("success");
    } catch (error) {
      console.log(error);
      reject("Python can't do math: ");
    }
  });
};

module.exports = test;
