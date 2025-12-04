// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MentalWellnessFHE is SepoliaConfig {
    struct EncryptedJournal {
        uint256 entryId;
        euint32 encryptedContent;    // Encrypted journal content
        euint32 encryptedMoodScore;  // Encrypted mood rating
        euint32 encryptedStressLevel; // Encrypted stress level
        uint256 timestamp;
    }

    struct EncryptedRecommendation {
        uint256 entryId;
        euint32 encryptedActivity;  // Encrypted recommended activity
        euint32 encryptedPriority;  // Encrypted recommendation priority
        uint256 generatedAt;
    }

    struct DecryptedRecommendation {
        string activity;
        uint32 priority;
        bool isRevealed;
    }

    uint256 public journalCount;
    uint256 public recommendationCount;
    mapping(uint256 => EncryptedJournal) public encryptedJournals;
    mapping(uint256 => EncryptedRecommendation) public encryptedRecommendations;
    mapping(uint256 => DecryptedRecommendation) public decryptedRecommendations;
    
    mapping(uint256 => uint256) private requestToJournalId;
    mapping(uint256 => uint256) private recommendationRequestToId;
    
    event JournalSubmitted(uint256 indexed entryId, uint256 timestamp);
    event RecommendationRequested(uint256 indexed requestId, uint256 entryId);
    event RecommendationGenerated(uint256 indexed recommendationId, uint256 entryId);
    event RecommendationDecrypted(uint256 indexed recommendationId);

    modifier onlyUser(uint256 entryId) {
        // Add proper user authentication in production
        _;
    }

    function submitEncryptedJournal(
        euint32 encryptedContent,
        euint32 encryptedMoodScore,
        euint32 encryptedStressLevel
    ) public {
        journalCount += 1;
        uint256 newEntryId = journalCount;
        
        encryptedJournals[newEntryId] = EncryptedJournal({
            entryId: newEntryId,
            encryptedContent: encryptedContent,
            encryptedMoodScore: encryptedMoodScore,
            encryptedStressLevel: encryptedStressLevel,
            timestamp: block.timestamp
        });
        
        emit JournalSubmitted(newEntryId, block.timestamp);
    }

    function requestWellnessRecommendation(uint256 entryId) public onlyUser(entryId) {
        EncryptedJournal storage journal = encryptedJournals[entryId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(journal.encryptedContent);
        ciphertexts[1] = FHE.toBytes32(journal.encryptedMoodScore);
        ciphertexts[2] = FHE.toBytes32(journal.encryptedStressLevel);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.generateRecommendation.selector);
        requestToJournalId[reqId] = entryId;
        
        emit RecommendationRequested(reqId, entryId);
    }

    function generateRecommendation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 entryId = requestToJournalId[requestId];
        require(entryId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory content, uint32 moodScore, uint32 stressLevel) = 
            abi.decode(cleartexts, (string, uint32, uint32));
        
        // Simulate FHE recommendation generation (in production this would be done off-chain)
        recommendationCount += 1;
        uint256 newRecommendationId = recommendationCount;
        
        // Simplified recommendation logic
        string memory activity;
        uint32 priority;
        
        if (stressLevel > 70) {
            activity = "Guided breathing exercise";
            priority = 1;
        } else if (moodScore < 30) {
            activity = "Positive affirmation practice";
            priority = 2;
        } else {
            activity = "Mindful walking";
            priority = 3;
        }
        
        encryptedRecommendations[newRecommendationId] = EncryptedRecommendation({
            entryId: entryId,
            encryptedActivity: FHE.asEuint32(0), // Placeholder for encrypted activity
            encryptedPriority: FHE.asEuint32(priority),
            generatedAt: block.timestamp
        });
        
        decryptedRecommendations[newRecommendationId] = DecryptedRecommendation({
            activity: activity,
            priority: priority,
            isRevealed: false
        });
        
        emit RecommendationGenerated(newRecommendationId, entryId);
    }

    function requestRecommendationDecryption(uint256 recommendationId) public onlyUser(recommendationId) {
        EncryptedRecommendation storage rec = encryptedRecommendations[recommendationId];
        require(!decryptedRecommendations[recommendationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(rec.encryptedActivity);
        ciphertexts[1] = FHE.toBytes32(rec.encryptedPriority);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptRecommendation.selector);
        recommendationRequestToId[reqId] = recommendationId;
    }

    function decryptRecommendation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 recommendationId = recommendationRequestToId[requestId];
        require(recommendationId != 0, "Invalid request");
        
        DecryptedRecommendation storage dRec = decryptedRecommendations[recommendationId];
        require(!dRec.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory activity, uint32 priority) = abi.decode(cleartexts, (string, uint32));
        
        dRec.activity = activity;
        dRec.priority = priority;
        dRec.isRevealed = true;
        
        emit RecommendationDecrypted(recommendationId);
    }

    function getDecryptedRecommendation(uint256 recommendationId) public view returns (
        string memory activity,
        uint32 priority,
        bool isRevealed
    ) {
        DecryptedRecommendation storage r = decryptedRecommendations[recommendationId];
        return (r.activity, r.priority, r.isRevealed);
    }

    function getEncryptedJournal(uint256 entryId) public view returns (
        euint32 content,
        euint32 moodScore,
        euint32 stressLevel,
        uint256 timestamp
    ) {
        EncryptedJournal storage j = encryptedJournals[entryId];
        return (j.encryptedContent, j.encryptedMoodScore, j.encryptedStressLevel, j.timestamp);
    }

    function getEncryptedRecommendation(uint256 recommendationId) public view returns (
        euint32 activity,
        euint32 priority,
        uint256 entryId,
        uint256 generatedAt
    ) {
        EncryptedRecommendation storage r = encryptedRecommendations[recommendationId];
        return (r.encryptedActivity, r.encryptedPriority, r.entryId, r.generatedAt);
    }
}