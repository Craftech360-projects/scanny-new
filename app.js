const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');

const server = http.createServer(app);
const io = socketIo(server); // ✅ Use Socket.IO

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Set the view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

let lastClickedItem = ''; // ✅ Store last clicked item

// ✅ Define separate video mappings for different screens
const videoMappings = {
    "1": {
        'EHVCA': 'VA1.mp4',
        'HVCA': 'VA2.mp4',
        'MVCA': 'VA3.mp4',
        'PCA': 'VA4.mp4',
        'TLA': 'VA5.mp4',
        'JB': 'VA6.mp4',
        'ELPS': 'VA7.mp4',
        'Oil Type': 'VA8.mp4',
        'AMPACT': 'VA9.mp4'
    },
    "2": {
        'MVCA': 'VB1.mp4',
        'LVCA': 'VB2.mp4',
        'OCP2': 'VB3.mp4',
        'DOV': 'VB4.mp4',
        'Cable': 'VB6.mp4',
        'Acc': 'VB7.mp4',
        'AMPACT': 'VB8.mp4',
        'LVABC': 'VB9.mp4',
        'Gloves':'VB10.mp4',
        'Mat': 'VB11.mp4'
    },
    "3": {
        'Connector': 'VC1.mp4',
        'Solar Trafo': 'VC2.mp4',
        'MVCA': 'VC3.mp4',
        'PCA': 'VC4.mp4',
        'OCP': 'VC5.mp4'
    },
    "4": {
        'Transformer': 'VD1.mp4',
        'Breaker': 'VD2.mp4',
        'Panel': 'VD3.mp4',
        'Surge Protector': 'VD4.mp4'
    },
    "5": {
        'Battery': 'VE1.mp4',
        'Inverter': 'VE2.mp4',
        'Solar Panel': 'VE3.mp4'
    }
};

// ✅ Function to get video file based on screen and clicked item
function getVideoFile(screenId, videoName) {
    videoName = videoName.trim().replace(/\s+›$/, ''); // ✅ Trim whitespace and remove special symbols
    console.log(`📌 Fetching video for Screen ${screenId}, Cleaned Item: "${videoName}"`);

    return videoMappings[screenId]?.[videoName] || 'default.mp4';
}

// ✅ Main Page
app.get('/', (req, res) => {
    res.render('mainscreen');
});

// ✅ Screens 1-5
app.get('/screen:id', (req, res) => {
    res.render(`screen${req.params.id}`);
});

// ✅ Single Video Player Page (No ID Change)
app.get('/videoPlayer', (req, res) => {
    res.render('videoPlayer', { videoName: lastClickedItem, videoFile: 'default.mp4' });
});

// ✅ Handle button click tracking for different screens
app.post('/track:id', (req, res) => {
    const screenId = req.params.id;
    let { item } = req.body;

    item = item.trim().replace(/\s+›$/, ''); // ✅ Ensure cleaned item
    console.log(`📩 POST /track${screenId} - Cleaned Item: "${item}"`);

    if (item) {
        lastClickedItem = item;
        const videoFile = getVideoFile(screenId, item);
        
        console.log(`📢 Emitting 'videoChange' with video: ${videoFile} for screen ${screenId}`);

        // ✅ Emit event to update `videoPlayer.ejs`
        io.emit(`videoChange`, { videoFile, videoName: item });

        res.status(200).json({ message: `Signal received for: ${item} on screen ${screenId}` });
    } else {
        console.log(`❌ Error: No item received on screen ${screenId}.`);
        res.status(400).json({ error: 'No item provided' });
    }
});


// ✅ Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log('✅ Client connected');

    socket.on('disconnect', () => {
        console.log('⚠️ Client disconnected');
    });
});

// ✅ Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
