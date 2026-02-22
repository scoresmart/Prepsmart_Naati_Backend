import { app } from "./app.js";
import { env } from "./config/env.js";
import { sequelize } from "./config/db.js";
import "./models/index.js";

// async function start() {
//   await sequelize.authenticate();
//   await sequelize.sync({ alter: true });

//   app.listen(env.port, () => {
//     console.log(`Server running on ${env.port}\n`);
//   });
// }

// start().catch((e) => {
//   process.stderr.write(`${e?.message || e}\n`);
//   process.exit(1);
// });

// Start the server immediately
app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}\n`);
});

// Connect to DB in the background
sequelize.sync().then(() => {
  console.log("Database connected successfully!");
}).catch((e) => {
  console.error(`Database connection failed: ${e?.message || e}`);
  console.log("Server is running but DB is not available.\n");
});
