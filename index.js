const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Simple health check and homepage for the tunnel to bypass browser warnings
app.get('/', (req, res) => {
    res.send('Server is Online and Ready!');
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["*"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

const waitingUsers = [];
const connectedPairs = new Map(); // Map<socketId, otherSocketId>
let onlineCount = 0;

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`User connected: ${socket.id}. Online: ${onlineCount}`);
    io.emit('online_users', onlineCount);

    socket.on('search', () => {
        console.log(`User ${socket.id} looking for match...`);
        
        // Clean out any stale/disconnected users from the waiting list
        while (waitingUsers.length > 0) {
            const partnerSocket = waitingUsers.pop();
            // Check if partner is still connected
            if (partnerSocket.connected && partnerSocket.id !== socket.id) {
                console.log(`Matching ${socket.id} with ${partnerSocket.id}`);
                connectedPairs.set(socket.id, partnerSocket.id);
                connectedPairs.set(partnerSocket.id, socket.id);
                
                // One becomes the caller, one becomes the receiver
                socket.emit('pair_matched', {remoteId: partnerSocket.id, role: 'caller'});
                partnerSocket.emit('pair_matched', {remoteId: socket.id, role: 'receiver'});
                return;
            }
        }
        
        // No valid partner found, add current user to waiting list
        waitingUsers.push(socket);
    });

    socket.on('offer', (data) => {
        const partnerId = connectedPairs.get(socket.id);
        if (partnerId) {
            console.log(`Offer from ${socket.id} -> ${partnerId}`);
            io.to(partnerId).emit('offer', { sdp: data.sdp, remoteId: socket.id });
        }
    });

    socket.on('answer', (data) => {
        const partnerId = connectedPairs.get(socket.id);
        if (partnerId) {
            console.log(`Answer from ${socket.id} -> ${partnerId}`);
            io.to(partnerId).emit('answer', { sdp: data.sdp, remoteId: socket.id });
        }
    });

    socket.on('ice_candidate', (data) => {
        const partnerId = connectedPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('ice_candidate', data);
        }
    });

    socket.on('chat_message', (msg) => {
        const partnerId = connectedPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('chat_message', msg);
        }
    });

    socket.on('disconnect', () => {
        onlineCount--;
        io.emit('online_users', onlineCount);
        console.log(`User ${socket.id} disconnected`);

        // Remove from waiting list if they were there
        const index = waitingUsers.indexOf(socket);
        if (index > -1) waitingUsers.splice(index, 1);

        const partnerId = connectedPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('chat_message', "Partner left");
            connectedPairs.delete(socket.id);
            connectedPairs.delete(partnerId);
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('-----------------------------------');
    console.log(`Server running on port ${PORT}`);
    console.log(`Local Access: http://localhost:${PORT}`);
    console.log('-----------------------------------');
});
