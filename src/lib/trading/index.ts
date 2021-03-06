import { BigNumber } from 'bignumber.js';
import * as ccxt from 'ccxt';
import * as types from '../type';
import { logger, Helper } from '../common';
import { Storage } from '../storage';
import { Mocker } from './mocker';
import { Order } from './order';
import { Daemon } from './daemon';

const clc = require('cli-color');
const config = require('config');

export class Trading {
  mocker: Mocker;
  order: Order;
  storage: Storage;
  daemon: Daemon;

  constructor() {
    this.mocker = new Mocker();
    this.storage = new Storage();
    this.order = new Order(this.storage);
    this.daemon = new Daemon(this.storage);
  }
  async testOrder(exchange: types.IExchange, triangle: types.ITriangle) {
    return await this.mocker.testOrder(exchange, triangle);
  }
  // 下单
  async placeOrder(exchange: types.IExchange, triangle: types.ITriangle) {
    try {
      // 清理超时数据
      await this.storage.queue.clearQueue();
      // 继续处理失败的队列
      await this.daemon.continueTrade(exchange);

      const limitCheck = await Helper.checkQueueLimit(this.storage.queue)
      if (!limitCheck) {
        logger.debug(`Too many order in queue..`);
        return;
      }
      const testTrade = await this.testOrder(exchange, triangle);
      // 未通过检查时返回
      if (!testTrade || !testTrade.id) {
        logger.info(`套利组合未通过可行性检测！！`);
        return;
      }

      if (config.trading.mock) {
        logger.info('配置为模拟交易，终止真实交易！');
        return;
      }

      logger.info('----- 套利Start -----');
      logger.info(`Path：${clc.cyanBright(triangle.id)} Rate: ${triangle.rate}`);

      // 放入交易队列
      const queueId = await this.storage.openTradingSession({
        mock: testTrade,
        real: testTrade
      });
      if (!queueId) {
        return;
      }
      testTrade.queueId = queueId;
      // 执行a点订单
      await this.order.orderA(exchange, testTrade);
    } catch (err) {
      logger.error(`处理订单出错： ${err.message ? err.message : err.msg}`);
      logger.error(err.stack);
      // 退出交易队列
      // await this.storage.clearQueue(triangle.id, exchange.id);
    }
  }
}
