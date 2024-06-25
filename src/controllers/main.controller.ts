import { NewMessage, NewMessageEvent } from 'telegram/events';
import { CommandHandler } from '../types/command-handler.interface';
import { CommandsCommand, RmCommand, StartCommand, StopCommand, SubCommand, TimerCommand, TranscribeCommand } from '../commands';
import { MessageFilterService, MessageService, SyncService } from '../services';
import TgClientAuth from '../auth/main.auth';

const COMMANDS: Record<string, string> = {
  START: '/start',
  STOP: '/stop',
  TIMER: '/timer',
  TRANSCRIBE: '/transcribe',
  SUB: '/sub',
  RM: '/rm',
  COMMANDS: '/commands',
};

export default class MainController {
  private readonly config: any;
  private readonly storageChannel: string;

  constructor(config: any) {
    this.config = config;
    this.storageChannel = this.config.get('TELEGRAM_STORAGE_CHANNEL_USERNAME');
  }

  async launch() {
    const botClientContainer = new TgClientAuth('BOT');
    const userClientContainer = new TgClientAuth('USER');

    const [botClient, userClient] = await Promise.all([botClientContainer.start(), userClientContainer.start()]);

    const messageFilterService = new MessageFilterService();
    const messageService = new MessageService(botClient, userClient);
    const syncService = new SyncService(this.config, messageService, messageFilterService);

    const botEntity = await userClient.getEntity(this.config.get('TELEGRAM_BOT_USERNAME'));

    console.log(`💥 initial start`);
    userClient.sendMessage(botEntity, { message: '/start' });

    const commandHandlers: Record<string, CommandHandler> = {
      [COMMANDS.START]: new StartCommand(syncService),
      [COMMANDS.STOP]: new StopCommand(syncService),
      [COMMANDS.TIMER]: new TimerCommand(syncService),
      [COMMANDS.TRANSCRIBE]: new TranscribeCommand(messageService, this.config),
      [COMMANDS.SUB]: new SubCommand(messageService, this.storageChannel),
      [COMMANDS.RM]: new RmCommand(messageService, this.storageChannel),
      [COMMANDS.COMMANDS]: new CommandsCommand(COMMANDS),
    };

    botClient.addEventHandler(async (event: NewMessageEvent) => {
      if (!event?.message?.message) return;

      try {
        const messageWrapper = event.message;
        const sender: any = await messageWrapper.getSender();
        const message: string = messageWrapper.message;

        const command = Object.keys(COMMANDS).find((key: string) => message.startsWith(COMMANDS[key]));
        if (command && commandHandlers[COMMANDS[command]]) {
          await commandHandlers[COMMANDS[command]].handle(botClient, sender, message);
        } else {
          const response = '❌ Invalid command, please check and try again. Call /commands to view all commands.';
          await botClient.sendMessage(sender, { message: response });
        }
      } catch (e) {
        console.log('❗❗❗ Error in handlers. Check it manually to resolve.');
      }
    }, new NewMessage({}));

    // console.log('b:', botClient.session.save());
    // console.log('u:', userClient.session.save());
  }
}
