const axios = require('axios');
const cheerio = require('cheerio');
const {CronJob} = require('cron');
const sqlite3 = require('sqlite3');
const promisify = require('es6-promisify');
const path = require('path');
const _ = require('lodash');

const db = new sqlite3.Database(
  process.env.SQLITE_PATH || path.join(__dirname, '../data.db')
);

// initialize table
(async () => {
  await promisify(db.run, db)(`
    CREATE TABLE IF NOT EXISTS mastodon_instances (
      id INTEGER PRIMARY KEY NOT NULL,
      instance TEXT NOT NULL,
      score INTEGER DEFAULT 0 NOT NULL,
      users INTEGER DEFAULT 0 NOT NULL,
      statuses INTEGER DEFAULT 0 NOT NULL,
      connections INTEGER DEFAULT 0 NOT NULL,
      uptime TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  await promisify(db.run, db)('CREATE INDEX IF NOT EXISTS idx_instance ON mastodon_instances (instance);');
  await promisify(db.run, db)('CREATE INDEX IF NOT EXISTS idx_created_at ON mastodon_instances (created_at);');
})();

const getMastodonList = async () => {
  const res = await axios.get('https://instances.mastodon.xyz/list');
  const $ = cheerio.load(res.data);
  return $('body > div > table > tbody > tr').map((i, tr) => ({
    score      : Number(_.trim($(tr).find('td:nth-child(2)').text())),
    instance   : _.trim($(tr).find('td:nth-child(3)').text()),
    users      : Number(_.trim($(tr).find('td:nth-child(4)').text())),
    statuses   : Number(_.trim($(tr).find('td:nth-child(5)').text())),
    connections: Number(_.trim($(tr).find('td:nth-child(6)').text())),
    uptime     : _.trim($(tr).find('td:nth-child(8)').text())
  })).get();
};

const storeMastodonList = async items => {
  for (const item of items) {
    await promisify(db.run, db)(`
      INSERT INTO mastodon_instances (
        instance,
        score,
        users,
        statuses,
        connections,
        uptime,
        created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `, [
      item.instance,
      item.score,
      item.users,
      item.statuses,
      item.connections,
      item.uptime,
      Date.now()
    ]);
  }
};

const getCurrentStats = async () => {
  const items = await promisify(db.all, db)(`
    SELECT * FROM mastodon_instances
    WHERE created_at > ?
  `, []);
  return items;
};

const run = async robot => {
  try {
    const items = _.sortBy(await getMastodonList(), item => -item.users).filter(item => item.users > 5000);
    await storeMastodonList(items);

    const text = '```\ninstance  users  statuses\n' + items.map(i => `${i.instance}  ${i.users}  ${i.statuses}`).join('\n') + '\n```';
    await robot.adapter.client.web.chat.postMessage(process.env.SLACK_CHANNEL, text, {as_user: true});
    robot.logger.info(`get ${items.length} items.`);
  } catch(e) {
    robot.logger.error(e.message);
  }
};

module.exports = robot => {
  robot.respond(/ma?sto?do?n-stats/, async () => {
    // TODO なんかしゃべらせたいね
    await getCurrentStats();
  });

  new CronJob({
    cronTime: '00 00 0,6,12,18 * * *',
    start   : true,
    timeZone: 'Asia/Tokyo',
    onTick  : () => run(robot)
  });
};
