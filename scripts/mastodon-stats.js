const axios = require('axios');
const cheerio = require('cheerio');
const {CronJob} = require('cron');

const getMastodonList = async () => {
  const res = await axios.get('https://instances.mastodon.xyz/list');
  const $ = cheerio.load(res.data);
  return $('body > div > table > tbody > tr').map((i, tr) => ({
    score      : Number($(tr).find('td:nth-child(2)').text()),
    instance   : $(tr).find('td:nth-child(3)').text(),
    users      : Number($(tr).find('td:nth-child(4)').text()),
    statuses   : Number($(tr).find('td:nth-child(5)').text()),
    connections: Number($(tr).find('td:nth-child(6)').text()),
    uptime     : $(tr).find('td:nth-child(8)').text()
  })).get();
};

module.exports = robot => {
  robot.respond(/mstdn-stats/, () => {
    // TODO なんかしゃべらせたいね
  });

  // TODO テスト用なので後で消す
  getMastodonList();

  new CronJob({
    cronTime: '00 00 0,6,12,18 * * *',
    start   : true,
    timeZone: 'Asia/Tokyo',
    onTick  : () => getMastodonList().catch(e => robot.logger.error(e.message))
  });
};
