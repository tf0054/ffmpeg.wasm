const fs = require("node:fs");

export const restart = () => {
  const currentDate = new Date();
  fs.writeFile(
    "restart.ts",
    `"${currentDate.toISOString()}"`,
    (err) => {
      if (err) {
        console.error(err);
      }
    },
  );
};
