/**
 * Human-readable ABI fragments for the calls the backend actually makes.
 *
 * Deliberately hand-written rather than imported from `artifacts/`: the backend
 * is a separate package that talks to a deployed address, and pinning it to the
 * contract build output would mean a recompile in the contracts package could
 * silently change what the backend thinks it is calling. If a signature here
 * stops matching the deployment, we want a loud decode failure, not a quiet drift.
 */

export const ADVERTISER_REGISTRY_ABI = [
  // Writes. Called by an advertiser's own wallet, not by the backend's keys -
  // used by the seed and live-verification scripts.
  "function register(string name, string domain) returns (bytes32)",
  "function updateClaim(string name, string domain) returns (bytes32)",
  // Reads.
  "function challengeOf(address advertiser) view returns (bytes32)",
  "function isVerified(address advertiser) view returns (bool)",
  "function statusOf(address advertiser) view returns (uint8)",
  "function registeredAt(address advertiser) view returns (uint64)",
  "function getAdvertiser(address advertiser) view returns (tuple(string name, string domain, bytes32 challenge, uint64 registeredAt, uint64 verifiedAt, uint8 status))",
  "function verifiedOwnerOfName(string name) view returns (address)",
  "function verifiedOwnerOfDomain(string domain) view returns (address)",
  "function advertiserCount() view returns (uint256)",
  "function advertiserAt(uint256 index) view returns (address)",
  "function canonicalHash(string value) view returns (bytes32)",
  "event AdvertiserRegistered(address indexed advertiser, string name, string domain, bytes32 indexed nameHash, bytes32 indexed domainHash, uint64 registeredAt)",
  "event AdvertiserVerified(address indexed advertiser, bool verified, bytes32 indexed nameHash, bytes32 indexed domainHash, uint64 timestamp)",
  // Declared so a revert decodes to a name instead of raw bytes.
  "error AlreadyRegistered()",
  "error NotRegistered()",
  "error EmptyName()",
  "error EmptyDomain()",
  "error NameTooLong(uint256 length, uint256 maximum)",
  "error DomainTooLong(uint256 length, uint256 maximum)",
  "error InvalidNameCharacter(uint256 index, bytes1 character)",
  "error InvalidDomainCharacter(uint256 index, bytes1 character)",
  "error MalformedName()",
  "error MalformedDomain()",
  "error NameClaimedByAnother(address holder)",
  "error DomainClaimedByAnother(address holder)",
] as const;

export const PLACEMENT_ESCROW_ABI = [
  "function lifetimeDeposited(address advertiser) view returns (uint256)",
  "function depositedSince(address advertiser, uint64 since) view returns (uint256)",
  "function placementCount(address advertiser) view returns (uint256)",
  "function escrowedBalance(address advertiser) view returns (uint256)",
  "function categoryLifetime(string category) view returns (uint256)",
] as const;

export const TIER_ATTESTATION_ABI = [
  "function tierOf(address advertiser) view returns (uint8)",
  "function currentTierOf(address advertiser) view returns (uint8)",
  "function isCurrent(address advertiser) view returns (bool)",
  "function getAttestation(address advertiser) view returns (tuple(uint8 tier, uint64 windowStart, uint64 windowEnd, uint64 attestedAt))",
  "function attestationValidity() view returns (uint64)",
] as const;

export const CRE_ATTESTATION_RECEIVER_ABI = [
  "function submitDomainVerification(address advertiser, bool verified, bytes32 challenge, uint64 checkedAt)",
  "function submitTierAttestation(address advertiser, uint8 tier, uint64 windowStart, uint64 windowEnd)",
  "function onReport(bytes metadata, bytes report)",
  "function encodeDomainReport(address advertiser, bool verified, bytes32 challenge, uint64 checkedAt) pure returns (bytes)",
  "function encodeTierReport(address advertiser, uint8 tier, uint64 windowStart, uint64 windowEnd) pure returns (bytes)",
  "function consumedReports(bytes32 metadataHash) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function SIMULATOR_ROLE() view returns (bytes32)",
  "function FORWARDER_ROLE() view returns (bytes32)",
  "event DomainVerificationRecorded(address indexed advertiser, bool verified, bytes32 indexed challenge, uint64 checkedAt)",
  "event TierAttestationForwarded(address indexed advertiser, uint8 indexed tier, uint64 windowStart, uint64 windowEnd)",
  // Errors, so a revert decodes to a name instead of raw bytes.
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error AdvertiserNotRegistered(address advertiser)",
  "error ChallengeMismatch(bytes32 expected, bytes32 provided)",
  "error CheckTimestampInFuture(uint64 checkedAt, uint64 nowTimestamp)",
  "error ReportAlreadyConsumed(bytes32 metadataHash)",
  "error UnknownReportKind(uint8 kind)",
  "error StaleWindow(uint64 windowEnd, uint64 lastWindowEnd)",
  "error WindowInFuture(uint64 windowEnd, uint64 nowTimestamp)",
  "error InvalidTier()",
  "error InvalidWindow(uint64 windowStart, uint64 windowEnd)",
  "error NameClaimedByAnother(address holder)",
  "error DomainClaimedByAnother(address holder)",
] as const;

export const SUBNAME_REGISTRY_ABI = [
  "function nodeOf(address advertiser) view returns (bytes32)",
  "function nameOfAdvertiser(address advertiser) view returns (string)",
  "function issuedCount() view returns (uint256)",
] as const;

export const SUSPICIOUS_PATTERN_RULE_ABI = [
  "function isFlagged(address advertiser) view returns (bool)",
  "function evaluate(address advertiser) view returns (tuple(bool flagged, bool registered, uint64 accountAge, uint256 placements, uint8 tier))",
] as const;
