// ---------------------------------- IMPORTS ----------------------------------
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os');
const chalk = require('chalk');
const path = require('path');
const ModbusRTU = require("modbus-serial"); // Import Modbus library
// ---------------------------------- INITIALIZATION ----------------------------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = 3000;
// Set EJS as the templating engine
app.set('view engine', 'ejs');
// Modbus TCP configuration
const MODBUS_SERVER_IP = "192.168.1.5"; // Replace with your Modbus server IP
const MODBUS_SERVER_PORT = 502;          // Default Modbus TCP port
const MODBUS_REGISTER_ADDRESS_1 = 40024;   // First Modbus register address to write to
const MODBUS_REGISTER_ADDRESS_2 = 40025;   // Second Modbus register address to write to
let modbusClient;
let isModbusConnected = false;
// ---------------------------------- MODBUS FUNCTIONS ----------------------------------


// Initialize Modbus TCP client (async version)
async function initializeModbusClient() {
    try {
        modbusClient = new ModbusRTU();
        await modbusClient.connectTCP(MODBUS_SERVER_IP, { port: MODBUS_SERVER_PORT });
        console.log(chalk.green(`Connected to Modbus TCP server at ${MODBUS_SERVER_IP}:${MODBUS_SERVER_PORT}`));
        isModbusConnected = true;

        // Listen for errors (e.g., disconnection)
        modbusClient.on('error', async (err) => {
            console.error(chalk.red(`Modbus connection error: ${err.message}`));
            isModbusConnected = false;
            console.log(chalk.yellow("Attempting to reconnect to Modbus server..."));
            await initializeModbusClient(); // Retry connection
        });
    } catch (err) {
        console.error(chalk.red(`Failed to connect to Modbus TCP server: ${err.message}`));
        console.log(chalk.yellow("Retrying connection in 5 seconds..."));
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
        await initializeModbusClient(); // Retry connection
    }
}

// Function to write data to a Modbus register
async function writeToModbusRegister(registerAddress, value) {
    if (!modbusClient || !modbusClient.isOpen) {
        console.error(chalk.red("Modbus client is not initialized or connection is not open. Skipping write operation."));
        return;
    }
    try {
        await modbusClient.writeRegister(registerAddress - 40001, value); // Subtract 40001 for 0-based indexing
        console.log(chalk.green(`Successfully wrote value ${value} to Modbus register ${registerAddress}`));
    } catch (err) {
        console.error(chalk.red(`Error writing to Modbus register ${registerAddress}: ${err.message}`));
        await initializeModbusClient(); // Reinitialize Modbus client
    }
}

// Function to handle sequential writes to Modbus registers
async function handleSequentialWrites(value) {
    if (!isModbusConnected) {
        console.error(chalk.red("Modbus client is not connected. Cannot process sequential writes."));
        return;
    }
    // Step 1: Write the received value to register 40024
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_1, value);

    // Step 2: After 1 second, write 1 to register 40025
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_2, 1);

    // Step 3: After another 1 second, write 0 to register 40025
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    await writeToModbusRegister(MODBUS_REGISTER_ADDRESS_2, 0);
}

async function sendValuesWithDelays() {

    console.log(chalk.cyan("Starting to send values with delays..."));
    // Ensure Modbus client is connected
    await initializeModbusClient();
    // Step 1: Send value 2
    await handleSequentialWrites(2);
    console.log(chalk.cyan("Sent value 2. Waiting for 40 seconds..."));
    // Step 2: Wait 40 seconds, then send value 3
    await new Promise(resolve => setTimeout(resolve, 40000)); // 40 seconds delay
    await initializeModbusClient();
    await handleSequentialWrites(3);
    console.log(chalk.cyan("Sent value 3. Waiting for 25 seconds..."));
    // Step 3: Wait 25 seconds, then send value 4
    await new Promise(resolve => setTimeout(resolve, 25000)); // 25 seconds delay
    await initializeModbusClient();
    await handleSequentialWrites(4);
    io.emit('buttonActive');
    console.log(chalk.cyan("Sent value 4. Process completed."));
}

// ---------------------------------- ROUTES ----------------------------------
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve the EJS file
app.get('/', (req, res) => {
    res.render('index'); // Renders views/index.ejs
});
app.get('/play', (req, res) => {
    res.render('play'); // Renders views/index.ejs
});

io.on('connection', (socket) => {
    console.log(chalk.green('A client connected via Socket.IO'));

    // Listen for 'sendValue' events from the client
    socket.on('sendValue', async (data) => {
        const { value } = data;
        if (value === undefined || isNaN(value)) {
            console.error(chalk.red('Invalid value received via Socket.IO'));
            return;
        }
        console.log(chalk.yellow(`Received Socket.IO request to send value: ${value}`));

        // Ensure Modbus client is connected
        await initializeModbusClient();

        // Handle sequential writes
        // await handleSequentialWrites(value);
        await handleSequentialWrites(4);
        io.emit('triggerVideo', value);
    });

    socket.on('sendValuesWithDelays', async () => {
        // Ensure Modbus client is connected
        // await initializeModbusClient();

        // Start sending values with delays
        await sendValuesWithDelays();
    });

    socket.on('video-ended', async () => {
        // Ensure Modbus client is connected
        // await initializeModbusClient();

        // Start sending values with delays
        await sendValuesWithDelays();
        io.emit('buttonInactive');
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log(chalk.yellow('A client disconnected'));
    });
});
// ---------------------------------- SERVER STARTUP ----------------------------------
// Initialize Modbus client and start the server
console.log(chalk.gray('Initializing Modbus TCP client...'));

// Get server IP address
function getServerIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const addresses = interfaces[interfaceName];
        for (const addressInfo of addresses) {
            if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
                return addressInfo.address;
            }
        }
    }
    return '0.0.0.0';
}

// Start the HTTP server
server.listen(port, '0.0.0.0', async () => {
    const ipAddress = getServerIPAddress();
    console.log(chalk.green(`Server is running on http://${ipAddress}:${port}`));

    // Initialize Modbus client after server starts
    await sendValuesWithDelays();

});