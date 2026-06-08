import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface ApprovePersonaProfilesData {
  personaProfile_updateMany: number;
}

export interface ApprovePersonaProfilesVariables {
  topicId: UUIDString;
}

export interface ApproveStakeholderMapData {
  stakeholderMap_update?: StakeholderMap_Key | null;
}

export interface ApproveStakeholderMapVariables {
  id: UUIDString;
}

export interface CompleteDebateSessionData {
  debateSession_update?: DebateSession_Key | null;
}

export interface CompleteDebateSessionVariables {
  id: UUIDString;
  totalTurns: number;
}

export interface CompletePersonaInterviewData {
  personaInterview_update?: PersonaInterview_Key | null;
}

export interface CompletePersonaInterviewVariables {
  id: UUIDString;
  interviewRecord: string;
}

export interface CreateCompletedPersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}

export interface CreateCompletedPersonaInterviewVariables {
  personaId: UUIDString;
  interviewRecord: string;
}

export interface CreateDebateSessionData {
  debateSession_insert: DebateSession_Key;
}

export interface CreateDebateSessionVariables {
  topicId: UUIDString;
}

export interface CreateDebateTopicData {
  debateTopic_insert: DebateTopic_Key;
}

export interface CreateDebateTopicVariables {
  title: string;
}

export interface CreateDebateTurnData {
  debateTurn_insert: DebateTurn_Key;
}

export interface CreateDebateTurnVariables {
  sessionId: UUIDString;
  turnIndex: number;
  speakerType: string;
  personaId?: UUIDString | null;
  content: string;
}

export interface CreateErrorPersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}

export interface CreateErrorPersonaInterviewVariables {
  personaId: UUIDString;
  errorMessage: string;
}

export interface CreatePersonaBeliefData {
  personaBelief_insert: PersonaBelief_Key;
}

export interface CreatePersonaBeliefVariables {
  personaId: UUIDString;
  version: number;
  content: string;
  changeType?: string | null;
  changeSummary?: string | null;
  triggeredByTurnId?: UUIDString | null;
}

export interface CreatePersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}

export interface CreatePersonaInterviewVariables {
  personaId: UUIDString;
  interviewRecord: string;
}

export interface CreatePersonaProfileData {
  personaProfile_insert: PersonaProfile_Key;
}

export interface CreatePersonaProfileVariables {
  topicId: UUIDString;
  stakeholderRole: string;
  name: string;
  age: number;
  occupation: string;
  background: string;
  interests: string;
  stanceDirection: string;
  sortOrder: number;
}

export interface CreatePostDebateCommentData {
  postDebateComment_insert: PostDebateComment_Key;
}

export interface CreatePostDebateCommentVariables {
  sessionId: UUIDString;
  personaId: UUIDString;
  content: string;
  sortOrder: number;
}

export interface CreateStakeholderMapData {
  stakeholderMap_insert: StakeholderMap_Key;
}

export interface CreateStakeholderMapVariables {
  topicId: UUIDString;
  content: string;
}

export interface DebateSession_Key {
  id: UUIDString;
  __typename?: 'DebateSession_Key';
}

export interface DebateTopic_Key {
  id: UUIDString;
  __typename?: 'DebateTopic_Key';
}

export interface DebateTurn_Key {
  id: UUIDString;
  __typename?: 'DebateTurn_Key';
}

export interface GetApprovedPersonasByTopicIdData {
  personaProfiles: ({
    id: UUIDString;
    topicId: UUIDString;
    stakeholderRole: string;
    name: string;
    age: number;
    occupation: string;
    background: string;
    interests: string;
    stanceDirection: string;
    approved: boolean;
    sortOrder: number;
  } & PersonaProfile_Key)[];
}

export interface GetApprovedPersonasByTopicIdVariables {
  topicId: UUIDString;
}

export interface GetDebateSessionByTopicIdData {
  debateSessions: ({
    id: UUIDString;
    topicId: UUIDString;
    status: string;
    totalTurns?: number | null;
    createdAt: TimestampString;
    completedAt?: TimestampString | null;
    publishedAt?: TimestampString | null;
  } & DebateSession_Key)[];
}

export interface GetDebateSessionByTopicIdVariables {
  topicId: UUIDString;
}

export interface GetDebateTurnsBySessionIdData {
  debateTurns: ({
    id: UUIDString;
    sessionId: UUIDString;
    turnIndex: number;
    speakerType: string;
    personaId?: UUIDString | null;
    content: string;
    createdAt: TimestampString;
  } & DebateTurn_Key)[];
}

export interface GetDebateTurnsBySessionIdVariables {
  sessionId: UUIDString;
}

export interface GetPersonaBeliefHistoryByTopicIdData {
  personaProfiles: ({
    id: UUIDString;
    name: string;
    stakeholderRole: string;
    personaBeliefs_on_persona: ({
      id: UUIDString;
      version: number;
      content: string;
      changeType?: string | null;
      changeSummary?: string | null;
      triggeredByTurnId?: UUIDString | null;
    } & PersonaBelief_Key)[];
  } & PersonaProfile_Key)[];
}

export interface GetPersonaBeliefHistoryByTopicIdVariables {
  topicId: UUIDString;
}

export interface GetPersonaBeliefsByPersonaIdData {
  personaBeliefs: ({
    id: UUIDString;
    personaId: UUIDString;
    version: number;
    content: string;
    changeType?: string | null;
    changeSummary?: string | null;
    triggeredByTurnId?: UUIDString | null;
    createdAt: TimestampString;
  } & PersonaBelief_Key)[];
}

export interface GetPersonaBeliefsByPersonaIdVariables {
  personaId: UUIDString;
}

export interface GetPersonaInterviewByPersonaIdData {
  personaInterviews: ({
    id: UUIDString;
    personaId: UUIDString;
    interviewRecord: string;
    status: string;
    errorMessage?: string | null;
    completedAt?: TimestampString | null;
  } & PersonaInterview_Key)[];
}

export interface GetPersonaInterviewByPersonaIdVariables {
  personaId: UUIDString;
}

export interface GetPersonasByTopicIdData {
  personaProfiles: ({
    id: UUIDString;
    topicId: UUIDString;
    stakeholderRole: string;
    name: string;
    age: number;
    occupation: string;
    background: string;
    interests: string;
    stanceDirection: string;
    approved: boolean;
    sortOrder: number;
  } & PersonaProfile_Key)[];
}

export interface GetPersonasByTopicIdVariables {
  topicId: UUIDString;
}

export interface GetPostDebateCommentsBySessionIdData {
  postDebateComments: ({
    id: UUIDString;
    sessionId: UUIDString;
    personaId: UUIDString;
    content: string;
    sortOrder: number;
  } & PostDebateComment_Key)[];
}

export interface GetPostDebateCommentsBySessionIdVariables {
  sessionId: UUIDString;
}

export interface GetPublishedDebateByIdData {
  debateSession?: {
    id: UUIDString;
    totalTurns?: number | null;
    publishedAt?: TimestampString | null;
    topic: {
      id: UUIDString;
      title: string;
    } & DebateTopic_Key;
      debateTurns_on_session: ({
        id: UUIDString;
        turnIndex: number;
        speakerType: string;
        content: string;
        persona?: {
          id: UUIDString;
          name: string;
          stakeholderRole: string;
        } & PersonaProfile_Key;
          personaBeliefs_on_triggeredByTurn: ({
            id: UUIDString;
            changeType?: string | null;
            changeSummary?: string | null;
            persona: {
              id: UUIDString;
              name: string;
            } & PersonaProfile_Key;
          } & PersonaBelief_Key)[];
      } & DebateTurn_Key)[];
        postDebateComments_on_session: ({
          id: UUIDString;
          content: string;
          sortOrder: number;
          persona: {
            id: UUIDString;
            name: string;
            stakeholderRole: string;
          } & PersonaProfile_Key;
        } & PostDebateComment_Key)[];
  } & DebateSession_Key;
}

export interface GetPublishedDebateByIdVariables {
  sessionId: UUIDString;
}

export interface GetPublishedDebatesData {
  debateSessions: ({
    id: UUIDString;
    totalTurns?: number | null;
    publishedAt?: TimestampString | null;
    topic: {
      id: UUIDString;
      title: string;
    } & DebateTopic_Key;
  } & DebateSession_Key)[];
}

export interface GetStakeholderMapByTopicIdData {
  stakeholderMaps: ({
    id: UUIDString;
    topicId: UUIDString;
    content: string;
    approved: boolean;
    createdAt: TimestampString;
  } & StakeholderMap_Key)[];
}

export interface GetStakeholderMapByTopicIdVariables {
  topicId: UUIDString;
}

export interface GetTopicByIdData {
  debateTopic?: {
    id: UUIDString;
    title: string;
    status: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & DebateTopic_Key;
}

export interface GetTopicByIdVariables {
  id: UUIDString;
}

export interface GetTopicsData {
  debateTopics: ({
    id: UUIDString;
    title: string;
    status: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & DebateTopic_Key)[];
}

export interface PersonaBelief_Key {
  id: UUIDString;
  __typename?: 'PersonaBelief_Key';
}

export interface PersonaInterview_Key {
  id: UUIDString;
  __typename?: 'PersonaInterview_Key';
}

export interface PersonaProfile_Key {
  id: UUIDString;
  __typename?: 'PersonaProfile_Key';
}

export interface PostDebateComment_Key {
  id: UUIDString;
  __typename?: 'PostDebateComment_Key';
}

export interface PublishDebateSessionData {
  debateSession_update?: DebateSession_Key | null;
}

export interface PublishDebateSessionVariables {
  id: UUIDString;
}

export interface StakeholderMap_Key {
  id: UUIDString;
  __typename?: 'StakeholderMap_Key';
}

export interface UpdateDebateSessionStatusData {
  debateSession_update?: DebateSession_Key | null;
}

export interface UpdateDebateSessionStatusVariables {
  id: UUIDString;
  status: string;
}

export interface UpdateDebateTopicStatusData {
  debateTopic_update?: DebateTopic_Key | null;
}

export interface UpdateDebateTopicStatusVariables {
  id: UUIDString;
  status: string;
}

export interface UpdatePersonaInterviewStatusData {
  personaInterview_update?: PersonaInterview_Key | null;
}

export interface UpdatePersonaInterviewStatusVariables {
  id: UUIDString;
  status: string;
  errorMessage?: string | null;
}

interface GetTopicsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetTopicsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetTopicsData, undefined>;
  operationName: string;
}
export const getTopicsRef: GetTopicsRef;

export function getTopics(options?: ExecuteQueryOptions): QueryPromise<GetTopicsData, undefined>;
export function getTopics(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetTopicsData, undefined>;

interface GetTopicByIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetTopicByIdVariables): QueryRef<GetTopicByIdData, GetTopicByIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetTopicByIdVariables): QueryRef<GetTopicByIdData, GetTopicByIdVariables>;
  operationName: string;
}
export const getTopicByIdRef: GetTopicByIdRef;

export function getTopicById(vars: GetTopicByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetTopicByIdData, GetTopicByIdVariables>;
export function getTopicById(dc: DataConnect, vars: GetTopicByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetTopicByIdData, GetTopicByIdVariables>;

interface GetStakeholderMapByTopicIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetStakeholderMapByTopicIdVariables): QueryRef<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetStakeholderMapByTopicIdVariables): QueryRef<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;
  operationName: string;
}
export const getStakeholderMapByTopicIdRef: GetStakeholderMapByTopicIdRef;

export function getStakeholderMapByTopicId(vars: GetStakeholderMapByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;
export function getStakeholderMapByTopicId(dc: DataConnect, vars: GetStakeholderMapByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;

interface GetPersonasByTopicIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonasByTopicIdVariables): QueryRef<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPersonasByTopicIdVariables): QueryRef<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;
  operationName: string;
}
export const getPersonasByTopicIdRef: GetPersonasByTopicIdRef;

export function getPersonasByTopicId(vars: GetPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;
export function getPersonasByTopicId(dc: DataConnect, vars: GetPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;

interface GetApprovedPersonasByTopicIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetApprovedPersonasByTopicIdVariables): QueryRef<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetApprovedPersonasByTopicIdVariables): QueryRef<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;
  operationName: string;
}
export const getApprovedPersonasByTopicIdRef: GetApprovedPersonasByTopicIdRef;

export function getApprovedPersonasByTopicId(vars: GetApprovedPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;
export function getApprovedPersonasByTopicId(dc: DataConnect, vars: GetApprovedPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;

interface GetPersonaInterviewByPersonaIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaInterviewByPersonaIdVariables): QueryRef<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPersonaInterviewByPersonaIdVariables): QueryRef<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;
  operationName: string;
}
export const getPersonaInterviewByPersonaIdRef: GetPersonaInterviewByPersonaIdRef;

export function getPersonaInterviewByPersonaId(vars: GetPersonaInterviewByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;
export function getPersonaInterviewByPersonaId(dc: DataConnect, vars: GetPersonaInterviewByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;

interface GetPersonaBeliefsByPersonaIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaBeliefsByPersonaIdVariables): QueryRef<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPersonaBeliefsByPersonaIdVariables): QueryRef<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;
  operationName: string;
}
export const getPersonaBeliefsByPersonaIdRef: GetPersonaBeliefsByPersonaIdRef;

export function getPersonaBeliefsByPersonaId(vars: GetPersonaBeliefsByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;
export function getPersonaBeliefsByPersonaId(dc: DataConnect, vars: GetPersonaBeliefsByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;

interface GetPersonaBeliefHistoryByTopicIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaBeliefHistoryByTopicIdVariables): QueryRef<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPersonaBeliefHistoryByTopicIdVariables): QueryRef<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;
  operationName: string;
}
export const getPersonaBeliefHistoryByTopicIdRef: GetPersonaBeliefHistoryByTopicIdRef;

export function getPersonaBeliefHistoryByTopicId(vars: GetPersonaBeliefHistoryByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;
export function getPersonaBeliefHistoryByTopicId(dc: DataConnect, vars: GetPersonaBeliefHistoryByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;

interface GetDebateSessionByTopicIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetDebateSessionByTopicIdVariables): QueryRef<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetDebateSessionByTopicIdVariables): QueryRef<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;
  operationName: string;
}
export const getDebateSessionByTopicIdRef: GetDebateSessionByTopicIdRef;

export function getDebateSessionByTopicId(vars: GetDebateSessionByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;
export function getDebateSessionByTopicId(dc: DataConnect, vars: GetDebateSessionByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;

interface GetDebateTurnsBySessionIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetDebateTurnsBySessionIdVariables): QueryRef<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetDebateTurnsBySessionIdVariables): QueryRef<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;
  operationName: string;
}
export const getDebateTurnsBySessionIdRef: GetDebateTurnsBySessionIdRef;

export function getDebateTurnsBySessionId(vars: GetDebateTurnsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;
export function getDebateTurnsBySessionId(dc: DataConnect, vars: GetDebateTurnsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;

interface GetPostDebateCommentsBySessionIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPostDebateCommentsBySessionIdVariables): QueryRef<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPostDebateCommentsBySessionIdVariables): QueryRef<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;
  operationName: string;
}
export const getPostDebateCommentsBySessionIdRef: GetPostDebateCommentsBySessionIdRef;

export function getPostDebateCommentsBySessionId(vars: GetPostDebateCommentsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;
export function getPostDebateCommentsBySessionId(dc: DataConnect, vars: GetPostDebateCommentsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;

interface GetPublishedDebatesRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetPublishedDebatesData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetPublishedDebatesData, undefined>;
  operationName: string;
}
export const getPublishedDebatesRef: GetPublishedDebatesRef;

export function getPublishedDebates(options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebatesData, undefined>;
export function getPublishedDebates(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebatesData, undefined>;

interface GetPublishedDebateByIdRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPublishedDebateByIdVariables): QueryRef<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPublishedDebateByIdVariables): QueryRef<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;
  operationName: string;
}
export const getPublishedDebateByIdRef: GetPublishedDebateByIdRef;

export function getPublishedDebateById(vars: GetPublishedDebateByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;
export function getPublishedDebateById(dc: DataConnect, vars: GetPublishedDebateByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;

interface CreateDebateTopicRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateTopicVariables): MutationRef<CreateDebateTopicData, CreateDebateTopicVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateDebateTopicVariables): MutationRef<CreateDebateTopicData, CreateDebateTopicVariables>;
  operationName: string;
}
export const createDebateTopicRef: CreateDebateTopicRef;

export function createDebateTopic(vars: CreateDebateTopicVariables): MutationPromise<CreateDebateTopicData, CreateDebateTopicVariables>;
export function createDebateTopic(dc: DataConnect, vars: CreateDebateTopicVariables): MutationPromise<CreateDebateTopicData, CreateDebateTopicVariables>;

interface UpdateDebateTopicStatusRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateDebateTopicStatusVariables): MutationRef<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateDebateTopicStatusVariables): MutationRef<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;
  operationName: string;
}
export const updateDebateTopicStatusRef: UpdateDebateTopicStatusRef;

export function updateDebateTopicStatus(vars: UpdateDebateTopicStatusVariables): MutationPromise<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;
export function updateDebateTopicStatus(dc: DataConnect, vars: UpdateDebateTopicStatusVariables): MutationPromise<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;

interface CreateStakeholderMapRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateStakeholderMapVariables): MutationRef<CreateStakeholderMapData, CreateStakeholderMapVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateStakeholderMapVariables): MutationRef<CreateStakeholderMapData, CreateStakeholderMapVariables>;
  operationName: string;
}
export const createStakeholderMapRef: CreateStakeholderMapRef;

export function createStakeholderMap(vars: CreateStakeholderMapVariables): MutationPromise<CreateStakeholderMapData, CreateStakeholderMapVariables>;
export function createStakeholderMap(dc: DataConnect, vars: CreateStakeholderMapVariables): MutationPromise<CreateStakeholderMapData, CreateStakeholderMapVariables>;

interface ApproveStakeholderMapRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ApproveStakeholderMapVariables): MutationRef<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ApproveStakeholderMapVariables): MutationRef<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;
  operationName: string;
}
export const approveStakeholderMapRef: ApproveStakeholderMapRef;

export function approveStakeholderMap(vars: ApproveStakeholderMapVariables): MutationPromise<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;
export function approveStakeholderMap(dc: DataConnect, vars: ApproveStakeholderMapVariables): MutationPromise<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;

interface CreatePersonaProfileRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaProfileVariables): MutationRef<CreatePersonaProfileData, CreatePersonaProfileVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreatePersonaProfileVariables): MutationRef<CreatePersonaProfileData, CreatePersonaProfileVariables>;
  operationName: string;
}
export const createPersonaProfileRef: CreatePersonaProfileRef;

export function createPersonaProfile(vars: CreatePersonaProfileVariables): MutationPromise<CreatePersonaProfileData, CreatePersonaProfileVariables>;
export function createPersonaProfile(dc: DataConnect, vars: CreatePersonaProfileVariables): MutationPromise<CreatePersonaProfileData, CreatePersonaProfileVariables>;

interface ApprovePersonaProfilesRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ApprovePersonaProfilesVariables): MutationRef<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ApprovePersonaProfilesVariables): MutationRef<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;
  operationName: string;
}
export const approvePersonaProfilesRef: ApprovePersonaProfilesRef;

export function approvePersonaProfiles(vars: ApprovePersonaProfilesVariables): MutationPromise<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;
export function approvePersonaProfiles(dc: DataConnect, vars: ApprovePersonaProfilesVariables): MutationPromise<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;

interface CreatePersonaInterviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaInterviewVariables): MutationRef<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreatePersonaInterviewVariables): MutationRef<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;
  operationName: string;
}
export const createPersonaInterviewRef: CreatePersonaInterviewRef;

export function createPersonaInterview(vars: CreatePersonaInterviewVariables): MutationPromise<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;
export function createPersonaInterview(dc: DataConnect, vars: CreatePersonaInterviewVariables): MutationPromise<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;

interface CreateCompletedPersonaInterviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateCompletedPersonaInterviewVariables): MutationRef<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateCompletedPersonaInterviewVariables): MutationRef<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;
  operationName: string;
}
export const createCompletedPersonaInterviewRef: CreateCompletedPersonaInterviewRef;

export function createCompletedPersonaInterview(vars: CreateCompletedPersonaInterviewVariables): MutationPromise<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;
export function createCompletedPersonaInterview(dc: DataConnect, vars: CreateCompletedPersonaInterviewVariables): MutationPromise<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;

interface CreateErrorPersonaInterviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateErrorPersonaInterviewVariables): MutationRef<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateErrorPersonaInterviewVariables): MutationRef<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;
  operationName: string;
}
export const createErrorPersonaInterviewRef: CreateErrorPersonaInterviewRef;

export function createErrorPersonaInterview(vars: CreateErrorPersonaInterviewVariables): MutationPromise<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;
export function createErrorPersonaInterview(dc: DataConnect, vars: CreateErrorPersonaInterviewVariables): MutationPromise<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;

interface UpdatePersonaInterviewStatusRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdatePersonaInterviewStatusVariables): MutationRef<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdatePersonaInterviewStatusVariables): MutationRef<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;
  operationName: string;
}
export const updatePersonaInterviewStatusRef: UpdatePersonaInterviewStatusRef;

export function updatePersonaInterviewStatus(vars: UpdatePersonaInterviewStatusVariables): MutationPromise<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;
export function updatePersonaInterviewStatus(dc: DataConnect, vars: UpdatePersonaInterviewStatusVariables): MutationPromise<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;

interface CompletePersonaInterviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CompletePersonaInterviewVariables): MutationRef<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CompletePersonaInterviewVariables): MutationRef<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;
  operationName: string;
}
export const completePersonaInterviewRef: CompletePersonaInterviewRef;

export function completePersonaInterview(vars: CompletePersonaInterviewVariables): MutationPromise<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;
export function completePersonaInterview(dc: DataConnect, vars: CompletePersonaInterviewVariables): MutationPromise<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;

interface CreatePersonaBeliefRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaBeliefVariables): MutationRef<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreatePersonaBeliefVariables): MutationRef<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;
  operationName: string;
}
export const createPersonaBeliefRef: CreatePersonaBeliefRef;

export function createPersonaBelief(vars: CreatePersonaBeliefVariables): MutationPromise<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;
export function createPersonaBelief(dc: DataConnect, vars: CreatePersonaBeliefVariables): MutationPromise<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;

interface CreateDebateSessionRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateSessionVariables): MutationRef<CreateDebateSessionData, CreateDebateSessionVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateDebateSessionVariables): MutationRef<CreateDebateSessionData, CreateDebateSessionVariables>;
  operationName: string;
}
export const createDebateSessionRef: CreateDebateSessionRef;

export function createDebateSession(vars: CreateDebateSessionVariables): MutationPromise<CreateDebateSessionData, CreateDebateSessionVariables>;
export function createDebateSession(dc: DataConnect, vars: CreateDebateSessionVariables): MutationPromise<CreateDebateSessionData, CreateDebateSessionVariables>;

interface UpdateDebateSessionStatusRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateDebateSessionStatusVariables): MutationRef<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateDebateSessionStatusVariables): MutationRef<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;
  operationName: string;
}
export const updateDebateSessionStatusRef: UpdateDebateSessionStatusRef;

export function updateDebateSessionStatus(vars: UpdateDebateSessionStatusVariables): MutationPromise<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;
export function updateDebateSessionStatus(dc: DataConnect, vars: UpdateDebateSessionStatusVariables): MutationPromise<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;

interface CompleteDebateSessionRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CompleteDebateSessionVariables): MutationRef<CompleteDebateSessionData, CompleteDebateSessionVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CompleteDebateSessionVariables): MutationRef<CompleteDebateSessionData, CompleteDebateSessionVariables>;
  operationName: string;
}
export const completeDebateSessionRef: CompleteDebateSessionRef;

export function completeDebateSession(vars: CompleteDebateSessionVariables): MutationPromise<CompleteDebateSessionData, CompleteDebateSessionVariables>;
export function completeDebateSession(dc: DataConnect, vars: CompleteDebateSessionVariables): MutationPromise<CompleteDebateSessionData, CompleteDebateSessionVariables>;

interface PublishDebateSessionRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: PublishDebateSessionVariables): MutationRef<PublishDebateSessionData, PublishDebateSessionVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: PublishDebateSessionVariables): MutationRef<PublishDebateSessionData, PublishDebateSessionVariables>;
  operationName: string;
}
export const publishDebateSessionRef: PublishDebateSessionRef;

export function publishDebateSession(vars: PublishDebateSessionVariables): MutationPromise<PublishDebateSessionData, PublishDebateSessionVariables>;
export function publishDebateSession(dc: DataConnect, vars: PublishDebateSessionVariables): MutationPromise<PublishDebateSessionData, PublishDebateSessionVariables>;

interface CreateDebateTurnRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateTurnVariables): MutationRef<CreateDebateTurnData, CreateDebateTurnVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateDebateTurnVariables): MutationRef<CreateDebateTurnData, CreateDebateTurnVariables>;
  operationName: string;
}
export const createDebateTurnRef: CreateDebateTurnRef;

export function createDebateTurn(vars: CreateDebateTurnVariables): MutationPromise<CreateDebateTurnData, CreateDebateTurnVariables>;
export function createDebateTurn(dc: DataConnect, vars: CreateDebateTurnVariables): MutationPromise<CreateDebateTurnData, CreateDebateTurnVariables>;

interface CreatePostDebateCommentRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePostDebateCommentVariables): MutationRef<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreatePostDebateCommentVariables): MutationRef<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;
  operationName: string;
}
export const createPostDebateCommentRef: CreatePostDebateCommentRef;

export function createPostDebateComment(vars: CreatePostDebateCommentVariables): MutationPromise<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;
export function createPostDebateComment(dc: DataConnect, vars: CreatePostDebateCommentVariables): MutationPromise<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;

