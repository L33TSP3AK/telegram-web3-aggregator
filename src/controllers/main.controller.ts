import { Api, TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Entity } from 'telegram/define';
import TgClientAuth from '../auth/main.auth';
import MessageService from '../services/message.service';
import { delay } from '../utils/main.utils';

export default class MainController {
  private readonly config: any;
  private readonly storageChannel: string;

  constructor(config: any) {
    this.config = config;
    this.storageChannel = this.config.get('TELEGRAM_STORAGE_CHANNEL_USERNAME');
  }

  async launch() {
    const botClientContainer = new TgClientAuth('BOT');
    const botClient = await botClientContainer.start();
    const userClientContainer = new TgClientAuth('USER');
    const userClient = await userClientContainer.start();

    const messageService = new MessageService(botClient, userClient);
    botClient.addEventHandler(async (event: NewMessageEvent) => {
      if (event?.message?.message) {
        const messageWrapper = event.message;
        const sender = await messageWrapper.getSender();
        const message = messageWrapper.message;
        try {
          if (message.startsWith('/transcribe')) {
            console.log(`💥 /transcribe handler, message: ${message}`);
            this.processTranscribeAudio(botClient, userClient, message, sender);
          }
          if (message.startsWith('/sub')) {
            console.log(`💥 /sub handler, message: ${message}`);
            this.processSubscriptionChannel(botClient, messageService, message, sender);
          }
          if (message.startsWith('/rm')) {
            console.log(`💥 /rm handler, message: ${message}`);
            this.processRemoveChannel(botClient, messageService, message, sender);
          }
          if (message.startsWith('/start')) {
            console.log(`💥 /start handler, execution time: ${new Date().toLocaleString()}`);
            setInterval(() => this.processStart(botClient, messageService, sender), 10000);
          }
          if (message.startsWith('/stop')) {
            console.log(`💥 /stop handler`);
            await botClient.disconnect();
          }
        } catch (e) {
          console.log('❗❗❗ Error in handlers. Check it manually to resolve.');
        }
      }
    }, new NewMessage({}));
  }

  async processTranscribeAudio(botClient: TelegramClient, userClient: TelegramClient, message: string, sender: any) {
    const msgId = message?.split(' ')[1];
    try {
      const result = await userClient.invoke(
        new Api.messages.TranscribeAudio({
          peer: this.config.get('TELEGRAM_TARGET_CHANNEL_USERNAME'),
          msgId: parseInt(msgId),
        }),
      );
      await botClient.sendMessage(sender, { message: result.text, parseMode: 'html' });
    } catch (e) {
      await botClient.sendMessage(sender, { message: JSON.stringify(e) });
    }
  }

  async processSubscriptionChannel(client: TelegramClient, messageService: MessageService, message: string, sender: any) {
    const channelName = message?.split(' ')[1];
    const storageChannelResult = await messageService.getMessagesHistory(this.storageChannel, 1);
    const lastForwardedResult = storageChannelResult.messages[0];
    const scrapChannels = this.markdownToChannels(lastForwardedResult.message);
    let replyMessage = '';
    try {
      const entity: Entity = await client.getEntity(channelName);
      if (entity.className === 'Channel') {
        if (!scrapChannels.map((item) => item.name).includes(channelName)) {
          scrapChannels.push({
            name: channelName,
            messageId: 0,
          });
          const markdown = this.channelsToMarkdown(scrapChannels);

          client.editMessage(this.storageChannel, { message: lastForwardedResult.id, text: markdown });
          replyMessage = `🔥 Channel <b>${channelName}</b> has been added to list.`;
        } else {
          replyMessage = `🙅🏻‍♂️ <b>${channelName}</b> is already in the list.`;
        }
      } else {
        replyMessage = `⚠️ Username <b>${channelName}</b> is of type <b>${entity.className}</b>. It must be channels only.`;
      }
    } catch (e) {
      replyMessage = `😕 Channel <b>${channelName}</b> doesn't exist, check the username.`;
    }

    await client.sendMessage(sender, { message: replyMessage, parseMode: 'html' });
  }

  async processStart(client: TelegramClient, messageService: MessageService, sender: any) {
    const storageChannelResult = await messageService.getMessagesHistory(this.storageChannel, 1);
    if (storageChannelResult.messages?.length) {
      let needToUpdate = false;
      const lastForwardedResult = storageChannelResult.messages[0];
      const scrapChannels = this.markdownToChannels(lastForwardedResult.message);
      for (const channel of scrapChannels) {
        const result = await messageService.getMessagesHistory(channel.name, 1);
        const messageIds = result?.messages.map((item: any) => item.id).toSorted();
        if (channel.messageId != messageIds[0]) {
          try {
            await messageService.forwardMessages(channel.name, this.config.get('TELEGRAM_TARGET_CHANNEL_USERNAME'), messageIds);
            client.sendMessage(sender, {
              message: `✨ Message ${messageIds[0]} has been forwarded from ${channel.name}.`,
              parseMode: 'html',
            });
            needToUpdate = true;
            channel.messageId = messageIds[0];
          } catch (e) {
            client.sendMessage(sender, {
              message: `🚩 Error in forwarding message ${messageIds[0]} from ${channel.name} channel.`,
              parseMode: 'html',
            });
          }
        }
      }

      if (needToUpdate) {
        console.log('scrapChannels:', scrapChannels);
        const markdown = this.channelsToMarkdown(scrapChannels);
        console.log('markdown:', markdown);
        client.editMessage(this.storageChannel, { message: lastForwardedResult.id, text: markdown });
      }
    } else {
      client.sendMessage(sender, {
        message: '🗑️ Store channel is empty.',
      });
    }
  }

  async processRemoveChannel(client: TelegramClient, messageService: MessageService, message: string, sender: any) {
    const channelName = message?.split(' ')[1];
    const storageChannelResult = await messageService.getMessagesHistory(this.storageChannel, 1);
    const lastForwardedResult = storageChannelResult.messages[0];
    const scrapChannels = this.markdownToChannels(lastForwardedResult.message);
    const channelNames = scrapChannels.map((item) => item.name);
    let replyMessage = '';
    if (channelNames.includes(channelName)) {
      const newChannels = scrapChannels.filter((item) => item.name !== channelName);
      const markdown = this.channelsToMarkdown(newChannels);
      client.editMessage(this.storageChannel, { message: lastForwardedResult.id, text: markdown });
      replyMessage = `🔥 Channel <b>${channelName}</b> has been removed successfully.`;
    } else {
      replyMessage = `🤷 Channel <b>${channelName}</b> doesn't exist in the list.`;
    }

    await client.sendMessage(sender, { message: replyMessage, parseMode: 'html' });
  }

  markdownToChannels(markdownContent: string) {
    const channels: Array<any> = [];
    const rows = markdownContent.trim().split('\n').slice(2);

    rows.forEach((row) => {
      const [name, messageId] = row
        .trim()
        .split('|')
        .slice(1, 3)
        .map((cell) => cell.trim());
      if (name && messageId) {
        channels.push({ name, messageId: parseInt(messageId) });
      }
    });

    return channels;
  }

  channelsToMarkdown(channels: Array<any>) {
    let markdown = '| Name | Message ID |\n';
    markdown += '| ---- | ---------- |\n';
    channels.forEach((channel) => {
      markdown += `| ${channel.name} | ${channel.messageId} |\n`;
    });
    return markdown;
  }
}
