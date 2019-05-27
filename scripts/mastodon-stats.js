const axios = require('axios');
const {CronJob} = require('cron');
const sqlite3 = require('sqlite3');
const promisify = require('es6-promisify');
const path = require('path');
const _ = require('lodash');
const Table = require('cli-table2');
const moment = require('moment-timezone');

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
  const {data} = await axios.get('https://instances.mastodon.xyz/instances.json');
  if (!data.length || data.length === 0) {
    throw new Error('items is empty!');
  }
  return data.map(item => ({
    score      : item.https_score || 0,
    instance   : item.name,
    users      : item.users,
    statuses   : item.statuses,
    connections: item.connections,
    uptime     : item.uptime
  }));
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

const formatNumber = num => num > 0 ? `+${num}` : `${num}`;

const printCurrentStats = async () => {
  const items = await promisify(db.all, db)(`
    SELECT * FROM mastodon_instances
    WHERE created_at > ?
  `, [Date.now() - 1000 * 60 * 60 * 30]);

  const table = new Table({
    head : ['instance', 'users', 'statuses'],
    chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''}
  });

  const byInstance = _.groupBy(items, 'instance');
  for (const items of _.values(byInstance)) {
    const max = _.maxBy(items, 'created_at');
    const old = _.find(items, item => Math.abs(item.created_at + 24 * 60 * 60 * 1000 - max.created_at) < 60 * 60 * 1000);
    table.push(
      old
        ? [
          max.instance,
          `${max.users} (${formatNumber(max.users - old.users)})`,
          `${max.statuses} (${formatNumber(max.statuses - old.statuses)})`
        ]
        : [max.instance, max.users, max.statuses]
    );
  }
  return '```\n' + table.toString() + '\n```';
};

const getAllDataAsCsv = async () => {
  const items = await promisify(db.all, db)(`
    SELECT * FROM mastodon_instances
  `, []);

  return 'instance,score,users,statuses,connections,uptime,created_at\n'
    + items.map(item =>
      `${item.instance},${item.score},${item.users},${item.statuses},${item.connections},${_.trim(item.uptime)},${moment(item.created_at).tz('Asia/Tokyo').format('YYYY/MM/DD HH:mm:ss')}`
    ).join('\n');
};

const run = async robot => {
  try {
    const items = _.sortBy(await getMastodonList(), item => -item.users).filter(item => item.users > 5000);
    await storeMastodonList(items);
    robot.logger.info(`get ${items.length} items.`);

    const text = await printCurrentStats();
    await robot.adapter.client.web.chat.postMessage(process.env.SLACK_CHANNEL, text, {as_user: true});
  } catch(e) {
    robot.logger.error(e.message);
    // const im = await robot.adapter.client.web.im.open(process.env.ERROR_SEND_USER_ID);
    // await robot.adapter.client.web.chat.postMessage(im.channel.id, e.message, {as_user: true});
  }
};

module.exports = robot => {
  robot.respond(/ma?sto?do?n-stats-csv/, async ctx => {
    try {
      ctx.finish();
      const csv = await getAllDataAsCsv();
      await robot.adapter.client.web.files.upload(`mastodon-stats-${moment().tz('Asia/Tokyo').format('YYYYMMDDHH')}.csv`, {
        channels: ctx.envelope.room,
        content: csv,
        filetype: 'csv'
      });
    } catch (e) {
      robot.logger.error(e);
    }
  });

  robot.respond(/ma?sto?do?n-stats/, async ctx => {
    try {
      ctx.send(await printCurrentStats());
    } catch(e) {
      robot.logger.error(e);
    }
  });

  robot.respond(/fetch/, async () => {
    await run(robot);
  });

  new CronJob({
    cronTime: '00 00 0,6,12,18 * * *',
    start   : true,
    timeZone: 'Asia/Tokyo',
    onTick  : () => run(robot)
  });
};
