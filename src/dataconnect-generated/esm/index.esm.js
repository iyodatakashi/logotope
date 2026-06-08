import { queryRef, executeQuery, validateArgsWithOptions, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'logotope',
  service: 'logotope',
  location: 'asia-northeast1'
};
export const getTopicsRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTopics');
}
getTopicsRef.operationName = 'GetTopics';

export function getTopics(dcOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined,false, false);
  return executeQuery(getTopicsRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getTopicByIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTopicById', inputVars);
}
getTopicByIdRef.operationName = 'GetTopicById';

export function getTopicById(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getTopicByIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getStakeholderMapByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetStakeholderMapByTopicId', inputVars);
}
getStakeholderMapByTopicIdRef.operationName = 'GetStakeholderMapByTopicId';

export function getStakeholderMapByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getStakeholderMapByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPersonasByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonasByTopicId', inputVars);
}
getPersonasByTopicIdRef.operationName = 'GetPersonasByTopicId';

export function getPersonasByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonasByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getApprovedPersonasByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetApprovedPersonasByTopicId', inputVars);
}
getApprovedPersonasByTopicIdRef.operationName = 'GetApprovedPersonasByTopicId';

export function getApprovedPersonasByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getApprovedPersonasByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPersonaInterviewByPersonaIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaInterviewByPersonaId', inputVars);
}
getPersonaInterviewByPersonaIdRef.operationName = 'GetPersonaInterviewByPersonaId';

export function getPersonaInterviewByPersonaId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaInterviewByPersonaIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPersonaBeliefsByPersonaIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaBeliefsByPersonaId', inputVars);
}
getPersonaBeliefsByPersonaIdRef.operationName = 'GetPersonaBeliefsByPersonaId';

export function getPersonaBeliefsByPersonaId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaBeliefsByPersonaIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPersonaBeliefHistoryByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPersonaBeliefHistoryByTopicId', inputVars);
}
getPersonaBeliefHistoryByTopicIdRef.operationName = 'GetPersonaBeliefHistoryByTopicId';

export function getPersonaBeliefHistoryByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPersonaBeliefHistoryByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getDebateSessionByTopicIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetDebateSessionByTopicId', inputVars);
}
getDebateSessionByTopicIdRef.operationName = 'GetDebateSessionByTopicId';

export function getDebateSessionByTopicId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getDebateSessionByTopicIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getDebateTurnsBySessionIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetDebateTurnsBySessionId', inputVars);
}
getDebateTurnsBySessionIdRef.operationName = 'GetDebateTurnsBySessionId';

export function getDebateTurnsBySessionId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getDebateTurnsBySessionIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPostDebateCommentsBySessionIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPostDebateCommentsBySessionId', inputVars);
}
getPostDebateCommentsBySessionIdRef.operationName = 'GetPostDebateCommentsBySessionId';

export function getPostDebateCommentsBySessionId(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPostDebateCommentsBySessionIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPublishedDebatesRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPublishedDebates');
}
getPublishedDebatesRef.operationName = 'GetPublishedDebates';

export function getPublishedDebates(dcOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined,false, false);
  return executeQuery(getPublishedDebatesRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const getPublishedDebateByIdRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetPublishedDebateById', inputVars);
}
getPublishedDebateByIdRef.operationName = 'GetPublishedDebateById';

export function getPublishedDebateById(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getPublishedDebateByIdRef(dcInstance, inputVars), inputOpts && inputOpts.fetchPolicy);
}

export const createDebateTopicRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateTopic', inputVars);
}
createDebateTopicRef.operationName = 'CreateDebateTopic';

export function createDebateTopic(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateTopicRef(dcInstance, inputVars));
}

export const updateDebateTopicStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateDebateTopicStatus', inputVars);
}
updateDebateTopicStatusRef.operationName = 'UpdateDebateTopicStatus';

export function updateDebateTopicStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updateDebateTopicStatusRef(dcInstance, inputVars));
}

export const createStakeholderMapRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateStakeholderMap', inputVars);
}
createStakeholderMapRef.operationName = 'CreateStakeholderMap';

export function createStakeholderMap(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createStakeholderMapRef(dcInstance, inputVars));
}

export const approveStakeholderMapRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'ApproveStakeholderMap', inputVars);
}
approveStakeholderMapRef.operationName = 'ApproveStakeholderMap';

export function approveStakeholderMap(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(approveStakeholderMapRef(dcInstance, inputVars));
}

export const createPersonaProfileRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaProfile', inputVars);
}
createPersonaProfileRef.operationName = 'CreatePersonaProfile';

export function createPersonaProfile(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaProfileRef(dcInstance, inputVars));
}

export const approvePersonaProfilesRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'ApprovePersonaProfiles', inputVars);
}
approvePersonaProfilesRef.operationName = 'ApprovePersonaProfiles';

export function approvePersonaProfiles(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(approvePersonaProfilesRef(dcInstance, inputVars));
}

export const createPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaInterview', inputVars);
}
createPersonaInterviewRef.operationName = 'CreatePersonaInterview';

export function createPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaInterviewRef(dcInstance, inputVars));
}

export const createCompletedPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateCompletedPersonaInterview', inputVars);
}
createCompletedPersonaInterviewRef.operationName = 'CreateCompletedPersonaInterview';

export function createCompletedPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createCompletedPersonaInterviewRef(dcInstance, inputVars));
}

export const createErrorPersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateErrorPersonaInterview', inputVars);
}
createErrorPersonaInterviewRef.operationName = 'CreateErrorPersonaInterview';

export function createErrorPersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createErrorPersonaInterviewRef(dcInstance, inputVars));
}

export const updatePersonaInterviewStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdatePersonaInterviewStatus', inputVars);
}
updatePersonaInterviewStatusRef.operationName = 'UpdatePersonaInterviewStatus';

export function updatePersonaInterviewStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updatePersonaInterviewStatusRef(dcInstance, inputVars));
}

export const completePersonaInterviewRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CompletePersonaInterview', inputVars);
}
completePersonaInterviewRef.operationName = 'CompletePersonaInterview';

export function completePersonaInterview(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(completePersonaInterviewRef(dcInstance, inputVars));
}

export const createPersonaBeliefRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePersonaBelief', inputVars);
}
createPersonaBeliefRef.operationName = 'CreatePersonaBelief';

export function createPersonaBelief(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPersonaBeliefRef(dcInstance, inputVars));
}

export const createDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateSession', inputVars);
}
createDebateSessionRef.operationName = 'CreateDebateSession';

export function createDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateSessionRef(dcInstance, inputVars));
}

export const updateDebateSessionStatusRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateDebateSessionStatus', inputVars);
}
updateDebateSessionStatusRef.operationName = 'UpdateDebateSessionStatus';

export function updateDebateSessionStatus(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updateDebateSessionStatusRef(dcInstance, inputVars));
}

export const completeDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CompleteDebateSession', inputVars);
}
completeDebateSessionRef.operationName = 'CompleteDebateSession';

export function completeDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(completeDebateSessionRef(dcInstance, inputVars));
}

export const publishDebateSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'PublishDebateSession', inputVars);
}
publishDebateSessionRef.operationName = 'PublishDebateSession';

export function publishDebateSession(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(publishDebateSessionRef(dcInstance, inputVars));
}

export const createDebateTurnRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDebateTurn', inputVars);
}
createDebateTurnRef.operationName = 'CreateDebateTurn';

export function createDebateTurn(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createDebateTurnRef(dcInstance, inputVars));
}

export const createPostDebateCommentRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreatePostDebateComment', inputVars);
}
createPostDebateCommentRef.operationName = 'CreatePostDebateComment';

export function createPostDebateComment(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createPostDebateCommentRef(dcInstance, inputVars));
}

