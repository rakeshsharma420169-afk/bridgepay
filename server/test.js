const contractManager = require('./src/contractManager');

async function test() {
    console.log('Testing contract connection...');
    
    const info = await contractManager.getTokenInfo();
    console.log('Token Info:', info);
    
    const balance = await contractManager.getTokenBalance('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    console.log('Balance:', balance);
}

test();