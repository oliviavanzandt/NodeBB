import * as winston from 'winston';
import * as user from '../user';
import * as notifications from '../notifications';
import * as sockets from '../socket.io';
import * as plugins from '../plugins';
import * as meta from '../meta';


// Define the Message interface
interface Message {
    roomId: string,
    system: boolean;
    content: string;
    fromUser: {
        displayname: string;
    };
}

interface Messaging {
    getUidsInRoom(roomId: string, start: number, end: number): Promise<string[]>;
    isGroupChat(roomId: string): Promise<boolean>;
    pushUnreadCount(uid: string): void;
    notifyUsersInRoom(fromUid: string, roomId: string, messageObj: Message): Promise<void>;
}

type queueObject = {
    roomId: string;
    uid: string;
    message: Message;
    timeout: NodeJS.Timeout;
};

export = function configureMessaging(Messaging: Messaging): { notifyUsersInRoom: typeof notifyUsersInRoom } {
    const notifyQueue: Record<string, queueObject> = {};

    async function sendNotifications(fromUid: string, uids: string[], roomId: string, messageObj: Message):
    Promise<void> {
        const isOnline = await user.isOnline(uids);
        uids = uids.filter((uid, index) => !isOnline[index] && parseInt(fromUid, 10) !== parseInt(uid, 10));

        if (!uids.length) {
            return;
        }

        const { displayname } = messageObj.fromUser;

        const isGroupChat = await Messaging.isGroupChat(roomId);
        const notificationType = isGroupChat ? 'new-group-chat' : 'new-chat';

        const notification = await notifications.create({
            type: notificationType,
            subject: `[[email:notif.chat.subject, ${displayname}]]`,
            bodyShort: `[[notifications:new_message_from, ${displayname}]]`,
            bodyLong: messageObj.content,
            nid: `chat_${fromUid}_${roomId}`,
            from: fromUid,
            path: `/chats/${messageObj.roomId}`,
        });

        delete notifyQueue[`${fromUid}:${roomId}`];
        notifications.push(notification, uids);
    }

    async function notifyUsersInRoom(fromUid: string, roomId: string, messageObj: Message): Promise<void> {
        let uids: string[] = await Messaging.getUidsInRoom(roomId, 0, -1);
        uids = await user.blocks.filterUids(fromUid, uids);

        let data: {
            roomId: string;
            fromUid: string;
            message: Message;
            uids: string[];
            self?: 0 | 1; // Define the type for 'self'
        }

        data = await plugins.hooks.fire('filter:messaging.notify', data);

        if (!data || !data.uids || !data.uids.length) {
            return;
        }

        uids = data.uids;
        uids.forEach((uid) => {
            data.self = parseInt(uid, 10) === parseInt(fromUid, 10) ? 1 : 0;
            Messaging.pushUnreadCount(uid);
            sockets.in(`uid_${uid}`).emit('event:chats.receive', data);
        });

        if (messageObj.system) {
            return;
        }

        let queueObj = notifyQueue[`${fromUid}:${roomId}`];
        if (queueObj) {
            queueObj.message.content += `\n${messageObj.content}`;
            clearTimeout(queueObj.timeout);
        } else {
            queueObj = {
                roomId: roomId,
                uid: fromUid, // You may need to adjust this part based on your application's logic
                message: messageObj,
                timeout: setTimeout(async () => {
                    try {
                        await sendNotifications(fromUid, uids, roomId, queueObj.message);
                    } catch (err) {
                        winston.error(`[messaging/notifications] Unable to send notification\n${err.stack}`);
                    }
                }, meta.config.notificationSendDelay * 1000),
            };
            notifyQueue[`${fromUid}:${roomId}`] = queueObj;
        }

        queueObj.timeout = setTimeout(async () => {
            try {
                await sendNotifications(fromUid, uids, roomId, queueObj.message);
            } catch (err) {
                winston.error(`[messaging/notifications] Unable to send notification\n${err.stack}`);
            }
        }, meta.config.notificationSendDelay * 1000);
    }

    return {
        notifyUsersInRoom,
    };

}

