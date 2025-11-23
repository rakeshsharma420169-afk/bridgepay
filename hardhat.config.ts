import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.19",
  networks: {
    sepolia: {
      url: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
      accounts: ["0xAf8a9Db8d6B73E24bFF24cD34Ce4AC580486E854"]
    }
  }
};
