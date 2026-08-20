import Sequelize from 'sequelize';
const s = new Sequelize.Sequelize('naati','admin','naatiPassword123',{host:'naati.c3aee242wqkd.ap-southeast-2.rds.amazonaws.com',dialect:'mysql',logging:false});
const [tables] = await s.query("SHOW TABLES");
console.log("Tables:", tables.map(t => Object.values(t)[0]));
const [rows2] = await s.query("SHOW TABLES LIKE '%attempt%'");
console.log("Attempt tables:", rows2.map(t => Object.values(t)[0]));
const [rows3] = await s.query("SHOW TABLES LIKE '%segment%'");
console.log("Segment tables:", rows3.map(t => Object.values(t)[0]));
await s.close();
