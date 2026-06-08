import { getDataConnect } from 'firebase-admin/data-connect';

const connectorConfig = {
  location: 'asia-northeast1',
  serviceId: 'logotope',
  connector: 'logotope',
};

function dc() {
  return getDataConnect(connectorConfig);
}

// ---- Types ----

export interface DebateTopic {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaProfile {
  id: string;
  topicId: string;
  stakeholderRole: string;
  name: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  approved: boolean;
  sortOrder: number;
}

export interface PersonaBelief {
  id: string;
  personaId: string;
  version: number;
  content: string;
  changeType?: string | null;
  changeSummary?: string | null;
  triggeredByTurnId?: string | null;
  createdAt: string;
}

export interface DebateTurn {
  id: string;
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string | null;
  content: string;
  createdAt: string;
}

export interface DebateSession {
  id: string;
  topicId: string;
  status: string;
  totalTurns?: number | null;
  createdAt: string;
  completedAt?: string | null;
  publishedAt?: string | null;
}

// ---- Topic ----

export async function createTopic(title: string): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreateDebateTopic', { title });
  return (result.data as { debateTopic_insert: { id: string } }).debateTopic_insert;
}

export async function updateTopicStatus(id: string, status: string): Promise<void> {
  await dc().executeMutation('UpdateDebateTopicStatus', { id, status });
}

export async function listTopics(): Promise<DebateTopic[]> {
  const result = await dc().executeQuery('GetTopics');
  return (result.data as { debateTopics: DebateTopic[] }).debateTopics;
}

export async function getTopicById(id: string): Promise<DebateTopic | null> {
  const result = await dc().executeQuery('GetTopicById', { id });
  return (result.data as { debateTopic: DebateTopic | null }).debateTopic;
}

// ---- StakeholderMap ----

export interface StakeholderMap {
  id: string;
  topicId: string;
  content: string;
  approved: boolean;
  createdAt: string;
}

export async function getStakeholderMapByTopicId(topicId: string): Promise<StakeholderMap | null> {
  const result = await dc().executeQuery('GetStakeholderMapByTopicId', { topicId });
  const maps = (result.data as { stakeholderMaps: StakeholderMap[] }).stakeholderMaps;
  return maps[0] ?? null;
}

export async function createStakeholderMap(topicId: string, content: string): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreateStakeholderMap', { topicId, content });
  return (result.data as { stakeholderMap_insert: { id: string } }).stakeholderMap_insert;
}

export async function approveStakeholderMap(id: string): Promise<void> {
  await dc().executeMutation('ApproveStakeholderMap', { id });
}

// ---- PersonaProfile ----

export interface CreatePersonaProfileParams {
  topicId: string;
  stakeholderRole: string;
  name: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  sortOrder: number;
}

export async function createPersonaProfile(params: CreatePersonaProfileParams): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreatePersonaProfile', params);
  return (result.data as { personaProfile_insert: { id: string } }).personaProfile_insert;
}

export async function approvePersonaProfiles(topicId: string): Promise<void> {
  await dc().executeMutation('ApprovePersonaProfiles', { topicId });
}

export async function getPersonasByTopicId(topicId: string): Promise<PersonaProfile[]> {
  const result = await dc().executeQuery('GetPersonasByTopicId', { topicId });
  return (result.data as { personaProfiles: PersonaProfile[] }).personaProfiles;
}

export async function getApprovedPersonasByTopicId(topicId: string): Promise<PersonaProfile[]> {
  const result = await dc().executeQuery('GetApprovedPersonasByTopicId', { topicId });
  return (result.data as { personaProfiles: PersonaProfile[] }).personaProfiles;
}

// ---- PersonaInterview ----

export async function createPersonaInterview(personaId: string, interviewRecord: string): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreatePersonaInterview', { personaId, interviewRecord });
  return (result.data as { personaInterview_insert: { id: string } }).personaInterview_insert;
}

export async function createCompletedPersonaInterview(personaId: string, interviewRecord: string): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreateCompletedPersonaInterview', { personaId, interviewRecord });
  return (result.data as { personaInterview_insert: { id: string } }).personaInterview_insert;
}

export async function createErrorPersonaInterview(personaId: string, errorMessage: string): Promise<void> {
  await dc().executeMutation('CreateErrorPersonaInterview', { personaId, errorMessage });
}

export async function completePersonaInterview(id: string, interviewRecord: string): Promise<void> {
  await dc().executeMutation('CompletePersonaInterview', { id, interviewRecord });
}

export async function updatePersonaInterviewStatus(id: string, status: string, errorMessage?: string): Promise<void> {
  await dc().executeMutation('UpdatePersonaInterviewStatus', { id, status, errorMessage });
}

// ---- PersonaBelief ----

export interface CreatePersonaBeliefParams {
  personaId: string;
  version: number;
  content: string;
  changeType?: string;
  changeSummary?: string;
  triggeredByTurnId?: string;
}

export async function createPersonaBelief(params: CreatePersonaBeliefParams): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreatePersonaBelief', params);
  return (result.data as { personaBelief_insert: { id: string } }).personaBelief_insert;
}

export async function getPersonaBeliefsByPersonaId(personaId: string): Promise<PersonaBelief[]> {
  const result = await dc().executeQuery('GetPersonaBeliefsByPersonaId', { personaId });
  return (result.data as { personaBeliefs: PersonaBelief[] }).personaBeliefs;
}

// ---- DebateSession ----

export async function createDebateSession(topicId: string): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreateDebateSession', { topicId });
  return (result.data as { debateSession_insert: { id: string } }).debateSession_insert;
}

export async function completeDebateSession(id: string, totalTurns: number): Promise<void> {
  await dc().executeMutation('CompleteDebateSession', { id, totalTurns });
}

export async function publishDebateSession(id: string): Promise<void> {
  await dc().executeMutation('PublishDebateSession', { id });
}

export async function getDebateSessionByTopicId(topicId: string): Promise<DebateSession | null> {
  const result = await dc().executeQuery('GetDebateSessionByTopicId', { topicId });
  const sessions = (result.data as { debateSessions: DebateSession[] }).debateSessions;
  return sessions[0] ?? null;
}

// ---- DebateTurn ----

export interface CreateDebateTurnParams {
  sessionId: string;
  turnIndex: number;
  speakerType: string;
  personaId?: string;
  content: string;
}

export async function createDebateTurn(params: CreateDebateTurnParams): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreateDebateTurn', params);
  return (result.data as { debateTurn_insert: { id: string } }).debateTurn_insert;
}

export async function getDebateTurnsBySessionId(sessionId: string): Promise<DebateTurn[]> {
  const result = await dc().executeQuery('GetDebateTurnsBySessionId', { sessionId });
  return (result.data as { debateTurns: DebateTurn[] }).debateTurns;
}

// ---- PersonaInterview (getter) ----

export interface PersonaInterview {
  id: string;
  personaId: string;
  interviewRecord: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: string | null;
}

export async function getPersonaInterviewByPersonaId(personaId: string): Promise<PersonaInterview | null> {
  const result = await dc().executeQuery('GetPersonaInterviewByPersonaId', { personaId });
  const interviews = (result.data as { personaInterviews: PersonaInterview[] }).personaInterviews;
  return interviews[0] ?? null;
}

export async function getDebateSessionById(id: string): Promise<DebateSession | null> {
  const result = await dc().executeQuery('GetDebateSessionById', { id });
  const sessions = (result.data as { debateSessions: DebateSession[] }).debateSessions;
  return sessions[0] ?? null;
}

export async function deletePersonaProfilesByTopicId(topicId: string): Promise<void> {
  await dc().executeMutation('DeletePersonaProfilesByTopicId', { topicId });
}

export async function deletePersonaInterviewsByTopicId(topicId: string): Promise<void> {
  await dc().executeMutation('DeletePersonaInterviewsByTopicId', { topicId });
}

export async function deletePersonaBeliefsByTopicId(topicId: string): Promise<void> {
  await dc().executeMutation('DeletePersonaBeliefsByTopicId', { topicId });
}

export async function deleteDebateSessionByTopicId(topicId: string): Promise<void> {
  await dc().executeMutation('DeleteDebateSessionByTopicId', { topicId });
}

export async function deleteDebateTurnsBySession(sessionId: string): Promise<void> {
  await dc().executeMutation('DeleteDebateTurnsBySession', { sessionId });
}

export async function deletePostDebateCommentsBySession(sessionId: string): Promise<void> {
  await dc().executeMutation('DeletePostDebateCommentsBySession', { sessionId });
}

export async function deleteDebateSession(id: string): Promise<void> {
  await dc().executeMutation('DeleteDebateSession', { id });
}

// ---- PostDebateComment ----

export interface CreatePostDebateCommentParams {
  sessionId: string;
  personaId: string;
  content: string;
  sortOrder: number;
}

export interface PostDebateComment {
  id: string;
  sessionId: string;
  personaId: string;
  content: string;
  sortOrder: number;
}

export async function createPostDebateComment(params: CreatePostDebateCommentParams): Promise<{ id: string }> {
  const result = await dc().executeMutation('CreatePostDebateComment', params);
  return (result.data as { postDebateComment_insert: { id: string } }).postDebateComment_insert;
}

export async function getPostDebateCommentsBySessionId(sessionId: string): Promise<PostDebateComment[]> {
  const result = await dc().executeQuery('GetPostDebateCommentsBySessionId', { sessionId });
  return (result.data as { postDebateComments: PostDebateComment[] }).postDebateComments;
}

// ---- PublishedSession ----

export interface PublishedSessionSummary {
  id: string;
  topicTitle: string;
  personaCount: number;
  publishedAt: string;
}

export async function getPublishedSessions(): Promise<PublishedSessionSummary[]> {
  const result = await dc().executeQuery('GetPublishedSessions');
  return (result.data as { publishedSessions: PublishedSessionSummary[] }).publishedSessions;
}
