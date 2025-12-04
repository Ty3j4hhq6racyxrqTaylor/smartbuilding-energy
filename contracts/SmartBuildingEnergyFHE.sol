// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SmartBuildingEnergyFHE is SepoliaConfig {
    struct EncryptedEnergyData {
        uint256 id;
        euint32 encryptedTenantUsage;   // Encrypted tenant usage
        euint32 encryptedTimestamp;     // Encrypted timestamp
        euint32 encryptedSystemLoad;    // Encrypted predicted load
        uint256 timestamp;
    }
    
    struct DecryptedEnergyData {
        uint32 tenantUsage;
        uint32 systemLoad;
        bool isRevealed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedEnergyData) public encryptedData;
    mapping(uint256 => DecryptedEnergyData) public decryptedData;

    mapping(string => euint32) private encryptedLoadSum;
    string[] private systemList;

    mapping(uint256 => uint256) private requestToDataId;

    event EnergyDataSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event EnergyDataDecrypted(uint256 indexed id);

    modifier onlyTenant(uint256 dataId) {
        _;
    }

    /// @notice Submit new encrypted energy data
    function submitEncryptedEnergyData(
        euint32 encryptedTenantUsage,
        euint32 encryptedTimestamp,
        euint32 encryptedSystemLoad
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;

        encryptedData[newId] = EncryptedEnergyData({
            id: newId,
            encryptedTenantUsage: encryptedTenantUsage,
            encryptedTimestamp: encryptedTimestamp,
            encryptedSystemLoad: encryptedSystemLoad,
            timestamp: block.timestamp
        });

        decryptedData[newId] = DecryptedEnergyData({
            tenantUsage: 0,
            systemLoad: 0,
            isRevealed: false
        });

        emit EnergyDataSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of energy data
    function requestEnergyDataDecryption(uint256 dataId) public onlyTenant(dataId) {
        EncryptedEnergyData storage dataEntry = encryptedData[dataId];
        require(!decryptedData[dataId].isRevealed, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(dataEntry.encryptedTenantUsage);
        ciphertexts[1] = FHE.toBytes32(dataEntry.encryptedTimestamp);
        ciphertexts[2] = FHE.toBytes32(dataEntry.encryptedSystemLoad);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptEnergyData.selector);
        requestToDataId[reqId] = dataId;

        emit DecryptionRequested(dataId);
    }

    /// @notice Callback for decrypted energy data
    function decryptEnergyData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");

        EncryptedEnergyData storage eData = encryptedData[dataId];
        DecryptedEnergyData storage dData = decryptedData[dataId];
        require(!dData.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));

        dData.tenantUsage = results[0];
        dData.systemLoad = results[2];
        dData.isRevealed = true;

        string memory systemKey = "central_system";
        if (FHE.isInitialized(encryptedLoadSum[systemKey]) == false) {
            encryptedLoadSum[systemKey] = FHE.asEuint32(0);
            systemList.push(systemKey);
        }
        encryptedLoadSum[systemKey] = FHE.add(
            encryptedLoadSum[systemKey],
            FHE.asEuint32(results[2])
        );

        emit EnergyDataDecrypted(dataId);
    }

    /// @notice Get decrypted energy data
    function getDecryptedEnergyData(uint256 dataId) public view returns (
        uint32 tenantUsage,
        uint32 systemLoad,
        bool isRevealed
    ) {
        DecryptedEnergyData storage dataEntry = decryptedData[dataId];
        return (dataEntry.tenantUsage, dataEntry.systemLoad, dataEntry.isRevealed);
    }

    /// @notice Get encrypted system load sum
    function getEncryptedLoadSum(string memory systemKey) public view returns (euint32) {
        return encryptedLoadSum[systemKey];
    }

    /// @notice Request decryption of system load sum
    function requestLoadSumDecryption(string memory systemKey) public {
        euint32 sum = encryptedLoadSum[systemKey];
        require(FHE.isInitialized(sum), "System not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(sum);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLoadSum.selector);
        requestToDataId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(systemKey)));
    }

    /// @notice Callback for decrypted load sum
    function decryptLoadSum(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 systemHash = requestToDataId[requestId];
        string memory systemKey = getSystemFromHash(systemHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 sum = abi.decode(cleartexts, (uint32));
    }

    // Helper functions
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getSystemFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < systemList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(systemList[i]))) == hash) {
                return systemList[i];
            }
        }
        revert("System not found");
    }
}
