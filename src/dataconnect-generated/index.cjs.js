const { queryRef, executeQuery, validateArgsWithOptions, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'logotope',
  service: 'logotope',
  location: 'asia-northeast1'
};
exports.connectorConfig = connectorConfig;

const getTopicsRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTopics');
}
getTopicsRef.operationName = 'GetTopics';
exports.getTopicsRef = getTopicsRef;

exports.getTopics = function getTopics(dcOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined,false, false);
  return executeQuery(getTopicsRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getTopicByIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTopicById', inputVars);
}
getTopicByIdRef.operationName = 'GetTopicById';
exports.getTopicByIdRef = getTopicByIdRef;

exports.getTopicById = function getTopicById(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getTopicByIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getStakeholderMapByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetStakeholderMapByTopicId', inputVars);
}
getStakeholderMapByTopicIdRef.operationName = 'GetStakeholderMapByTopicId';
exports.getStakeholderMapByTopicIdRef = getStakeholderMapByTopicIdRef;

exports.getStakeholderMapByTopicId = function getStakeholderMapByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getStakeholderMapByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPersonasByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonasByTopicId', inputVars);
}
getPersonasByTopicIdRef.operationName = 'GetPersonasByTopicId';
exports.getPersonasByTopicIdRef = getPersonasByTopicIdRef;

exports.getPersonasByTopicId = function getPersonasByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonasByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getApprovedPersonasByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetApprovedPersonasByTopicId', inputVars);
}
getApprovedPersonasByTopicIdRef.operationName = 'GetApprovedPersonasByTopicId';
exports.getApprovedPersonasByTopicIdRef = getApprovedPersonasByTopicIdRef;

exports.getApprovedPersonasByTopicId = function getApprovedPersonasByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getApprovedPersonasByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPersonaInterviewByPersonaIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaInterviewByPersonaId', inputVars);
}
getPersonaInterviewByPersonaIdRef.operationName = 'GetPersonaInterviewByPersonaId';
exports.getPersonaInterviewByPersonaIdRef = getPersonaInterviewByPersonaIdRef;

exports.getPersonaInterviewByPersonaId = function getPersonaInterviewByPersonaId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaInterviewByPersonaIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPersonaBeliefsByPersonaIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaBeliefsByPersonaId', inputVars);
}
getPersonaBeliefsByPersonaIdRef.operationName = 'GetPersonaBeliefsByPersonaId';
exports.getPersonaBeliefsByPersonaIdRef = getPersonaBeliefsByPersonaIdRef;

exports.getPersonaBeliefsByPersonaId = function getPersonaBeliefsByPersonaId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaBeliefsByPersonaIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPersonaBeliefHistoryByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaBeliefHistoryByTopicId', inputVars);
}
getPersonaBeliefHistoryByTopicIdRef.operationName = 'GetPersonaBeliefHistoryByTopicId';
exports.getPersonaBeliefHistoryByTopicIdRef = getPersonaBeliefHistoryByTopicIdRef;

exports.getPersonaBeliefHistoryByTopicId = function getPersonaBeliefHistoryByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaBeliefHistoryByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getDebateSessionByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetDebateSessionByTopicId', inputVars);
}
getDebateSessionByTopicIdRef.operationName = 'GetDebateSessionByTopicId';
exports.getDebateSessionByTopicIdRef = getDebateSessionByTopicIdRef;

exports.getDebateSessionByTopicId = function getDebateSessionByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getDebateSessionByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getDebateTurnsBySessionIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetDebateTurnsBySessionId', inputVars);
}
getDebateTurnsBySessionIdRef.operationName = 'GetDebateTurnsBySessionId';
exports.getDebateTurnsBySessionIdRef = getDebateTurnsBySessionIdRef;

exports.getDebateTurnsBySessionId = function getDebateTurnsBySessionId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getDebateTurnsBySessionIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPostDebateCommentsBySessionIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPostDebateCommentsBySessionId', inputVars);
}
getPostDebateCommentsBySessionIdRef.operationName = 'GetPostDebateCommentsBySessionId';
exports.getPostDebateCommentsBySessionIdRef = getPostDebateCommentsBySessionIdRef;

exports.getPostDebateCommentsBySessionId = function getPostDebateCommentsBySessionId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPostDebateCommentsBySessionIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPublishedDebatesRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPublishedDebates');
}
getPublishedDebatesRef.operationName = 'GetPublishedDebates';
exports.getPublishedDebatesRef = getPublishedDebatesRef;

exports.getPublishedDebates = function getPublishedDebates(dcOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined,false, false);
  return executeQuery(getPublishedDebatesRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const getPublishedDebateByIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPublishedDebateById', inputVars);
}
getPublishedDebateByIdRef.operationName = 'GetPublishedDebateById';
exports.getPublishedDebateByIdRef = getPublishedDebateByIdRef;

exports.getPublishedDebateById = function getPublishedDebateById(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPublishedDebateByIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}
;

const createDebateTopicRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateTopic', inputVars);
}
createDebateTopicRef.operationName = 'CreateDebateTopic';
exports.createDebateTopicRef = createDebateTopicRef;

exports.createDebateTopic = function createDebateTopic(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateTopicRef(dcInstance, inputVars));
}
;

const updateDebateTopicStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateDebateTopicStatus', inputVars);
}
updateDebateTopicStatusRef.operationName = 'UpdateDebateTopicStatus';
exports.updateDebateTopicStatusRef = updateDebateTopicStatusRef;

exports.updateDebateTopicStatus = function updateDebateTopicStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updateDebateTopicStatusRef(dcInstance, inputVars));
}
;

const createStakeholderMapRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateStakeholderMap', inputVars);
}
createStakeholderMapRef.operationName = 'CreateStakeholderMap';
exports.createStakeholderMapRef = createStakeholderMapRef;

exports.createStakeholderMap = function createStakeholderMap(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createStakeholderMapRef(dcInstance, inputVars));
}
;

const approveStakeholderMapRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'ApproveStakeholderMap', inputVars);
}
approveStakeholderMapRef.operationName = 'ApproveStakeholderMap';
exports.approveStakeholderMapRef = approveStakeholderMapRef;

exports.approveStakeholderMap = function approveStakeholderMap(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(approveStakeholderMapRef(dcInstance, inputVars));
}
;

const createPersonaProfileRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaProfile', inputVars);
}
createPersonaProfileRef.operationName = 'CreatePersonaProfile';
exports.createPersonaProfileRef = createPersonaProfileRef;

exports.createPersonaProfile = function createPersonaProfile(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaProfileRef(dcInstance, inputVars));
}
;

const approvePersonaProfilesRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'ApprovePersonaProfiles', inputVars);
}
approvePersonaProfilesRef.operationName = 'ApprovePersonaProfiles';
exports.approvePersonaProfilesRef = approvePersonaProfilesRef;

exports.approvePersonaProfiles = function approvePersonaProfiles(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(approvePersonaProfilesRef(dcInstance, inputVars));
}
;

const createPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaInterview', inputVars);
}
createPersonaInterviewRef.operationName = 'CreatePersonaInterview';
exports.createPersonaInterviewRef = createPersonaInterviewRef;

exports.createPersonaInterview = function createPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaInterviewRef(dcInstance, inputVars));
}
;

const createCompletedPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateCompletedPersonaInterview', inputVars);
}
createCompletedPersonaInterviewRef.operationName = 'CreateCompletedPersonaInterview';
exports.createCompletedPersonaInterviewRef = createCompletedPersonaInterviewRef;

exports.createCompletedPersonaInterview = function createCompletedPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createCompletedPersonaInterviewRef(dcInstance, inputVars));
}
;

const createErrorPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateErrorPersonaInterview', inputVars);
}
createErrorPersonaInterviewRef.operationName = 'CreateErrorPersonaInterview';
exports.createErrorPersonaInterviewRef = createErrorPersonaInterviewRef;

exports.createErrorPersonaInterview = function createErrorPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createErrorPersonaInterviewRef(dcInstance, inputVars));
}
;

const updatePersonaInterviewStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdatePersonaInterviewStatus', inputVars);
}
updatePersonaInterviewStatusRef.operationName = 'UpdatePersonaInterviewStatus';
exports.updatePersonaInterviewStatusRef = updatePersonaInterviewStatusRef;

exports.updatePersonaInterviewStatus = function updatePersonaInterviewStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updatePersonaInterviewStatusRef(dcInstance, inputVars));
}
;

const completePersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CompletePersonaInterview', inputVars);
}
completePersonaInterviewRef.operationName = 'CompletePersonaInterview';
exports.completePersonaInterviewRef = completePersonaInterviewRef;

exports.completePersonaInterview = function completePersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(completePersonaInterviewRef(dcInstance, inputVars));
}
;

const createPersonaBeliefRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaBelief', inputVars);
}
createPersonaBeliefRef.operationName = 'CreatePersonaBelief';
exports.createPersonaBeliefRef = createPersonaBeliefRef;

exports.createPersonaBelief = function createPersonaBelief(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaBeliefRef(dcInstance, inputVars));
}
;

const createDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateSession', inputVars);
}
createDebateSessionRef.operationName = 'CreateDebateSession';
exports.createDebateSessionRef = createDebateSessionRef;

exports.createDebateSession = function createDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateSessionRef(dcInstance, inputVars));
}
;

const updateDebateSessionStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateDebateSessionStatus', inputVars);
}
updateDebateSessionStatusRef.operationName = 'UpdateDebateSessionStatus';
exports.updateDebateSessionStatusRef = updateDebateSessionStatusRef;

exports.updateDebateSessionStatus = function updateDebateSessionStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updateDebateSessionStatusRef(dcInstance, inputVars));
}
;

const completeDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CompleteDebateSession', inputVars);
}
completeDebateSessionRef.operationName = 'CompleteDebateSession';
exports.completeDebateSessionRef = completeDebateSessionRef;

exports.completeDebateSession = function completeDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(completeDebateSessionRef(dcInstance, inputVars));
}
;

const publishDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'PublishDebateSession', inputVars);
}
publishDebateSessionRef.operationName = 'PublishDebateSession';
exports.publishDebateSessionRef = publishDebateSessionRef;

exports.publishDebateSession = function publishDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(publishDebateSessionRef(dcInstance, inputVars));
}
;

const createDebateTurnRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateTurn', inputVars);
}
createDebateTurnRef.operationName = 'CreateDebateTurn';
exports.createDebateTurnRef = createDebateTurnRef;

exports.createDebateTurn = function createDebateTurn(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateTurnRef(dcInstance, inputVars));
}
;

const createPostDebateCommentRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePostDebateComment', inputVars);
}
createPostDebateCommentRef.operationName = 'CreatePostDebateComment';
exports.createPostDebateCommentRef = createPostDebateCommentRef;

exports.createPostDebateComment = function createPostDebateComment(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPostDebateCommentRef(dcInstance, inputVars));
}
;
