"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const winston = __importStar(require("winston"));
const user = __importStar(require("../user"));
const notifications = __importStar(require("../notifications"));
const sockets = __importStar(require("../socket.io"));
const plugins = __importStar(require("../plugins"));
const meta = __importStar(require("../meta"));
module.exports = function configureMessaging(Messaging) {
    const notifyQueue = {};
    function sendNotifications(fromUid, uids, roomId, messageObj) {
        return __awaiter(this, void 0, void 0, function* () {
            const isOnline = yield user.isOnline(uids);
            uids = uids.filter((uid, index) => !isOnline[index] && parseInt(fromUid, 10) !== parseInt(uid, 10));
            if (!uids.length) {
                return;
            }
            const { displayname } = messageObj.fromUser;
            const isGroupChat = yield Messaging.isGroupChat(roomId);
            const notificationType = isGroupChat ? 'new-group-chat' : 'new-chat';
            const notification = yield notifications.create({
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
        });
    }
    function notifyUsersInRoom(fromUid, roomId, messageObj) {
        return __awaiter(this, void 0, void 0, function* () {
            let uids = yield Messaging.getUidsInRoom(roomId, 0, -1);
            uids = yield user.blocks.filterUids(fromUid, uids);
            let data = {
                roomId: roomId,
                fromUid: fromUid,
                message: messageObj,
                uids: uids,
            };
            data = yield plugins.hooks.fire('filter:messaging.notify', data);
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
            }
            else {
                queueObj = {
                    roomId: roomId,
                    uid: fromUid,
                    message: messageObj,
                    timeout: setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                        try {
                            yield sendNotifications(fromUid, uids, roomId, queueObj.message);
                        }
                        catch (err) {
                            winston.error(`[messaging/notifications] Unable to send notification\n${err.stack}`);
                        }
                    }), meta.config.notificationSendDelay * 1000),
                };
                notifyQueue[`${fromUid}:${roomId}`] = queueObj;
            }
            queueObj.timeout = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    yield sendNotifications(fromUid, uids, roomId, queueObj.message);
                }
                catch (err) {
                    winston.error(`[messaging/notifications] Unable to send notification\n${err.stack}`);
                }
            }), meta.config.notificationSendDelay * 1000);
        });
    }
    return {
        notifyUsersInRoom,
    };
};
