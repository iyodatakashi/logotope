# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `logotope`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*GetTopics*](#gettopics)
  - [*GetTopicById*](#gettopicbyid)
  - [*GetStakeholderMapByTopicId*](#getstakeholdermapbytopicid)
  - [*GetPersonasByTopicId*](#getpersonasbytopicid)
  - [*GetApprovedPersonasByTopicId*](#getapprovedpersonasbytopicid)
  - [*GetPersonaInterviewByPersonaId*](#getpersonainterviewbypersonaid)
  - [*GetPersonaBeliefsByPersonaId*](#getpersonabeliefsbypersonaid)
  - [*GetPersonaBeliefHistoryByTopicId*](#getpersonabeliefhistorybytopicid)
  - [*GetDebateSessionByTopicId*](#getdebatesessionbytopicid)
  - [*GetDebateTurnsBySessionId*](#getdebateturnsbysessionid)
  - [*GetPostDebateCommentsBySessionId*](#getpostdebatecommentsbysessionid)
  - [*GetPublishedDebates*](#getpublisheddebates)
  - [*GetPublishedDebateById*](#getpublisheddebatebyid)
- [**Mutations**](#mutations)
  - [*CreateDebateTopic*](#createdebatetopic)
  - [*UpdateDebateTopicStatus*](#updatedebatetopicstatus)
  - [*CreateStakeholderMap*](#createstakeholdermap)
  - [*ApproveStakeholderMap*](#approvestakeholdermap)
  - [*CreatePersonaProfile*](#createpersonaprofile)
  - [*ApprovePersonaProfiles*](#approvepersonaprofiles)
  - [*CreatePersonaInterview*](#createpersonainterview)
  - [*CreateCompletedPersonaInterview*](#createcompletedpersonainterview)
  - [*CreateErrorPersonaInterview*](#createerrorpersonainterview)
  - [*UpdatePersonaInterviewStatus*](#updatepersonainterviewstatus)
  - [*CompletePersonaInterview*](#completepersonainterview)
  - [*CreatePersonaBelief*](#createpersonabelief)
  - [*CreateDebateSession*](#createdebatesession)
  - [*UpdateDebateSessionStatus*](#updatedebatesessionstatus)
  - [*CompleteDebateSession*](#completedebatesession)
  - [*PublishDebateSession*](#publishdebatesession)
  - [*CreateDebateTurn*](#createdebateturn)
  - [*CreatePostDebateComment*](#createpostdebatecomment)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `logotope`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `logotope` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## GetTopics
You can execute the `GetTopics` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getTopics(options?: ExecuteQueryOptions): QueryPromise<GetTopicsData, undefined>;

interface GetTopicsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetTopicsData, undefined>;
}
export const getTopicsRef: GetTopicsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getTopics(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetTopicsData, undefined>;

interface GetTopicsRef {
  ...
  (dc: DataConnect): QueryRef<GetTopicsData, undefined>;
}
export const getTopicsRef: GetTopicsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getTopicsRef:
```typescript
const name = getTopicsRef.operationName;
console.log(name);
```

### Variables
The `GetTopics` query has no variables.
### Return Type
Recall that executing the `GetTopics` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetTopicsData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetTopicsData {
  debateTopics: ({
    id: UUIDString;
    title: string;
    status: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & DebateTopic_Key)[];
}
```
### Using `GetTopics`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getTopics } from '@dataconnect/generated';


// Call the `getTopics()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getTopics();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getTopics(dataConnect);

console.log(data.debateTopics);

// Or, you can use the `Promise` API.
getTopics().then((response) => {
  const data = response.data;
  console.log(data.debateTopics);
});
```

### Using `GetTopics`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getTopicsRef } from '@dataconnect/generated';


// Call the `getTopicsRef()` function to get a reference to the query.
const ref = getTopicsRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getTopicsRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateTopics);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTopics);
});
```

## GetTopicById
You can execute the `GetTopicById` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getTopicById(vars: GetTopicByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetTopicByIdData, GetTopicByIdVariables>;

interface GetTopicByIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetTopicByIdVariables): QueryRef<GetTopicByIdData, GetTopicByIdVariables>;
}
export const getTopicByIdRef: GetTopicByIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getTopicById(dc: DataConnect, vars: GetTopicByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetTopicByIdData, GetTopicByIdVariables>;

interface GetTopicByIdRef {
  ...
  (dc: DataConnect, vars: GetTopicByIdVariables): QueryRef<GetTopicByIdData, GetTopicByIdVariables>;
}
export const getTopicByIdRef: GetTopicByIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getTopicByIdRef:
```typescript
const name = getTopicByIdRef.operationName;
console.log(name);
```

### Variables
The `GetTopicById` query requires an argument of type `GetTopicByIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetTopicByIdVariables {
  id: UUIDString;
}
```
### Return Type
Recall that executing the `GetTopicById` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetTopicByIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetTopicByIdData {
  debateTopic?: {
    id: UUIDString;
    title: string;
    status: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & DebateTopic_Key;
}
```
### Using `GetTopicById`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getTopicById, GetTopicByIdVariables } from '@dataconnect/generated';

// The `GetTopicById` query requires an argument of type `GetTopicByIdVariables`:
const getTopicByIdVars: GetTopicByIdVariables = {
  id: ..., 
};

// Call the `getTopicById()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getTopicById(getTopicByIdVars);
// Variables can be defined inline as well.
const { data } = await getTopicById({ id: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getTopicById(dataConnect, getTopicByIdVars);

console.log(data.debateTopic);

// Or, you can use the `Promise` API.
getTopicById(getTopicByIdVars).then((response) => {
  const data = response.data;
  console.log(data.debateTopic);
});
```

### Using `GetTopicById`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getTopicByIdRef, GetTopicByIdVariables } from '@dataconnect/generated';

// The `GetTopicById` query requires an argument of type `GetTopicByIdVariables`:
const getTopicByIdVars: GetTopicByIdVariables = {
  id: ..., 
};

// Call the `getTopicByIdRef()` function to get a reference to the query.
const ref = getTopicByIdRef(getTopicByIdVars);
// Variables can be defined inline as well.
const ref = getTopicByIdRef({ id: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getTopicByIdRef(dataConnect, getTopicByIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateTopic);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTopic);
});
```

## GetStakeholderMapByTopicId
You can execute the `GetStakeholderMapByTopicId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getStakeholderMapByTopicId(vars: GetStakeholderMapByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;

interface GetStakeholderMapByTopicIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetStakeholderMapByTopicIdVariables): QueryRef<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;
}
export const getStakeholderMapByTopicIdRef: GetStakeholderMapByTopicIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getStakeholderMapByTopicId(dc: DataConnect, vars: GetStakeholderMapByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;

interface GetStakeholderMapByTopicIdRef {
  ...
  (dc: DataConnect, vars: GetStakeholderMapByTopicIdVariables): QueryRef<GetStakeholderMapByTopicIdData, GetStakeholderMapByTopicIdVariables>;
}
export const getStakeholderMapByTopicIdRef: GetStakeholderMapByTopicIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getStakeholderMapByTopicIdRef:
```typescript
const name = getStakeholderMapByTopicIdRef.operationName;
console.log(name);
```

### Variables
The `GetStakeholderMapByTopicId` query requires an argument of type `GetStakeholderMapByTopicIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetStakeholderMapByTopicIdVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `GetStakeholderMapByTopicId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetStakeholderMapByTopicIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetStakeholderMapByTopicIdData {
  stakeholderMaps: ({
    id: UUIDString;
    topicId: UUIDString;
    content: string;
    approved: boolean;
    createdAt: TimestampString;
  } & StakeholderMap_Key)[];
}
```
### Using `GetStakeholderMapByTopicId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getStakeholderMapByTopicId, GetStakeholderMapByTopicIdVariables } from '@dataconnect/generated';

// The `GetStakeholderMapByTopicId` query requires an argument of type `GetStakeholderMapByTopicIdVariables`:
const getStakeholderMapByTopicIdVars: GetStakeholderMapByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getStakeholderMapByTopicId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getStakeholderMapByTopicId(getStakeholderMapByTopicIdVars);
// Variables can be defined inline as well.
const { data } = await getStakeholderMapByTopicId({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getStakeholderMapByTopicId(dataConnect, getStakeholderMapByTopicIdVars);

console.log(data.stakeholderMaps);

// Or, you can use the `Promise` API.
getStakeholderMapByTopicId(getStakeholderMapByTopicIdVars).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMaps);
});
```

### Using `GetStakeholderMapByTopicId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getStakeholderMapByTopicIdRef, GetStakeholderMapByTopicIdVariables } from '@dataconnect/generated';

// The `GetStakeholderMapByTopicId` query requires an argument of type `GetStakeholderMapByTopicIdVariables`:
const getStakeholderMapByTopicIdVars: GetStakeholderMapByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getStakeholderMapByTopicIdRef()` function to get a reference to the query.
const ref = getStakeholderMapByTopicIdRef(getStakeholderMapByTopicIdVars);
// Variables can be defined inline as well.
const ref = getStakeholderMapByTopicIdRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getStakeholderMapByTopicIdRef(dataConnect, getStakeholderMapByTopicIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.stakeholderMaps);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMaps);
});
```

## GetPersonasByTopicId
You can execute the `GetPersonasByTopicId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPersonasByTopicId(vars: GetPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;

interface GetPersonasByTopicIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonasByTopicIdVariables): QueryRef<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;
}
export const getPersonasByTopicIdRef: GetPersonasByTopicIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPersonasByTopicId(dc: DataConnect, vars: GetPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;

interface GetPersonasByTopicIdRef {
  ...
  (dc: DataConnect, vars: GetPersonasByTopicIdVariables): QueryRef<GetPersonasByTopicIdData, GetPersonasByTopicIdVariables>;
}
export const getPersonasByTopicIdRef: GetPersonasByTopicIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPersonasByTopicIdRef:
```typescript
const name = getPersonasByTopicIdRef.operationName;
console.log(name);
```

### Variables
The `GetPersonasByTopicId` query requires an argument of type `GetPersonasByTopicIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPersonasByTopicIdVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPersonasByTopicId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPersonasByTopicIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPersonasByTopicId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPersonasByTopicId, GetPersonasByTopicIdVariables } from '@dataconnect/generated';

// The `GetPersonasByTopicId` query requires an argument of type `GetPersonasByTopicIdVariables`:
const getPersonasByTopicIdVars: GetPersonasByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getPersonasByTopicId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPersonasByTopicId(getPersonasByTopicIdVars);
// Variables can be defined inline as well.
const { data } = await getPersonasByTopicId({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPersonasByTopicId(dataConnect, getPersonasByTopicIdVars);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
getPersonasByTopicId(getPersonasByTopicIdVars).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

### Using `GetPersonasByTopicId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPersonasByTopicIdRef, GetPersonasByTopicIdVariables } from '@dataconnect/generated';

// The `GetPersonasByTopicId` query requires an argument of type `GetPersonasByTopicIdVariables`:
const getPersonasByTopicIdVars: GetPersonasByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getPersonasByTopicIdRef()` function to get a reference to the query.
const ref = getPersonasByTopicIdRef(getPersonasByTopicIdVars);
// Variables can be defined inline as well.
const ref = getPersonasByTopicIdRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPersonasByTopicIdRef(dataConnect, getPersonasByTopicIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

## GetApprovedPersonasByTopicId
You can execute the `GetApprovedPersonasByTopicId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getApprovedPersonasByTopicId(vars: GetApprovedPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;

interface GetApprovedPersonasByTopicIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetApprovedPersonasByTopicIdVariables): QueryRef<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;
}
export const getApprovedPersonasByTopicIdRef: GetApprovedPersonasByTopicIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getApprovedPersonasByTopicId(dc: DataConnect, vars: GetApprovedPersonasByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;

interface GetApprovedPersonasByTopicIdRef {
  ...
  (dc: DataConnect, vars: GetApprovedPersonasByTopicIdVariables): QueryRef<GetApprovedPersonasByTopicIdData, GetApprovedPersonasByTopicIdVariables>;
}
export const getApprovedPersonasByTopicIdRef: GetApprovedPersonasByTopicIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getApprovedPersonasByTopicIdRef:
```typescript
const name = getApprovedPersonasByTopicIdRef.operationName;
console.log(name);
```

### Variables
The `GetApprovedPersonasByTopicId` query requires an argument of type `GetApprovedPersonasByTopicIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetApprovedPersonasByTopicIdVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `GetApprovedPersonasByTopicId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetApprovedPersonasByTopicIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetApprovedPersonasByTopicId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getApprovedPersonasByTopicId, GetApprovedPersonasByTopicIdVariables } from '@dataconnect/generated';

// The `GetApprovedPersonasByTopicId` query requires an argument of type `GetApprovedPersonasByTopicIdVariables`:
const getApprovedPersonasByTopicIdVars: GetApprovedPersonasByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getApprovedPersonasByTopicId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getApprovedPersonasByTopicId(getApprovedPersonasByTopicIdVars);
// Variables can be defined inline as well.
const { data } = await getApprovedPersonasByTopicId({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getApprovedPersonasByTopicId(dataConnect, getApprovedPersonasByTopicIdVars);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
getApprovedPersonasByTopicId(getApprovedPersonasByTopicIdVars).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

### Using `GetApprovedPersonasByTopicId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getApprovedPersonasByTopicIdRef, GetApprovedPersonasByTopicIdVariables } from '@dataconnect/generated';

// The `GetApprovedPersonasByTopicId` query requires an argument of type `GetApprovedPersonasByTopicIdVariables`:
const getApprovedPersonasByTopicIdVars: GetApprovedPersonasByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getApprovedPersonasByTopicIdRef()` function to get a reference to the query.
const ref = getApprovedPersonasByTopicIdRef(getApprovedPersonasByTopicIdVars);
// Variables can be defined inline as well.
const ref = getApprovedPersonasByTopicIdRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getApprovedPersonasByTopicIdRef(dataConnect, getApprovedPersonasByTopicIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

## GetPersonaInterviewByPersonaId
You can execute the `GetPersonaInterviewByPersonaId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPersonaInterviewByPersonaId(vars: GetPersonaInterviewByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;

interface GetPersonaInterviewByPersonaIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaInterviewByPersonaIdVariables): QueryRef<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;
}
export const getPersonaInterviewByPersonaIdRef: GetPersonaInterviewByPersonaIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPersonaInterviewByPersonaId(dc: DataConnect, vars: GetPersonaInterviewByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;

interface GetPersonaInterviewByPersonaIdRef {
  ...
  (dc: DataConnect, vars: GetPersonaInterviewByPersonaIdVariables): QueryRef<GetPersonaInterviewByPersonaIdData, GetPersonaInterviewByPersonaIdVariables>;
}
export const getPersonaInterviewByPersonaIdRef: GetPersonaInterviewByPersonaIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPersonaInterviewByPersonaIdRef:
```typescript
const name = getPersonaInterviewByPersonaIdRef.operationName;
console.log(name);
```

### Variables
The `GetPersonaInterviewByPersonaId` query requires an argument of type `GetPersonaInterviewByPersonaIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPersonaInterviewByPersonaIdVariables {
  personaId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPersonaInterviewByPersonaId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPersonaInterviewByPersonaIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPersonaInterviewByPersonaId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPersonaInterviewByPersonaId, GetPersonaInterviewByPersonaIdVariables } from '@dataconnect/generated';

// The `GetPersonaInterviewByPersonaId` query requires an argument of type `GetPersonaInterviewByPersonaIdVariables`:
const getPersonaInterviewByPersonaIdVars: GetPersonaInterviewByPersonaIdVariables = {
  personaId: ..., 
};

// Call the `getPersonaInterviewByPersonaId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPersonaInterviewByPersonaId(getPersonaInterviewByPersonaIdVars);
// Variables can be defined inline as well.
const { data } = await getPersonaInterviewByPersonaId({ personaId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPersonaInterviewByPersonaId(dataConnect, getPersonaInterviewByPersonaIdVars);

console.log(data.personaInterviews);

// Or, you can use the `Promise` API.
getPersonaInterviewByPersonaId(getPersonaInterviewByPersonaIdVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterviews);
});
```

### Using `GetPersonaInterviewByPersonaId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPersonaInterviewByPersonaIdRef, GetPersonaInterviewByPersonaIdVariables } from '@dataconnect/generated';

// The `GetPersonaInterviewByPersonaId` query requires an argument of type `GetPersonaInterviewByPersonaIdVariables`:
const getPersonaInterviewByPersonaIdVars: GetPersonaInterviewByPersonaIdVariables = {
  personaId: ..., 
};

// Call the `getPersonaInterviewByPersonaIdRef()` function to get a reference to the query.
const ref = getPersonaInterviewByPersonaIdRef(getPersonaInterviewByPersonaIdVars);
// Variables can be defined inline as well.
const ref = getPersonaInterviewByPersonaIdRef({ personaId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPersonaInterviewByPersonaIdRef(dataConnect, getPersonaInterviewByPersonaIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personaInterviews);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterviews);
});
```

## GetPersonaBeliefsByPersonaId
You can execute the `GetPersonaBeliefsByPersonaId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPersonaBeliefsByPersonaId(vars: GetPersonaBeliefsByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;

interface GetPersonaBeliefsByPersonaIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaBeliefsByPersonaIdVariables): QueryRef<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;
}
export const getPersonaBeliefsByPersonaIdRef: GetPersonaBeliefsByPersonaIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPersonaBeliefsByPersonaId(dc: DataConnect, vars: GetPersonaBeliefsByPersonaIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;

interface GetPersonaBeliefsByPersonaIdRef {
  ...
  (dc: DataConnect, vars: GetPersonaBeliefsByPersonaIdVariables): QueryRef<GetPersonaBeliefsByPersonaIdData, GetPersonaBeliefsByPersonaIdVariables>;
}
export const getPersonaBeliefsByPersonaIdRef: GetPersonaBeliefsByPersonaIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPersonaBeliefsByPersonaIdRef:
```typescript
const name = getPersonaBeliefsByPersonaIdRef.operationName;
console.log(name);
```

### Variables
The `GetPersonaBeliefsByPersonaId` query requires an argument of type `GetPersonaBeliefsByPersonaIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPersonaBeliefsByPersonaIdVariables {
  personaId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPersonaBeliefsByPersonaId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPersonaBeliefsByPersonaIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPersonaBeliefsByPersonaId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPersonaBeliefsByPersonaId, GetPersonaBeliefsByPersonaIdVariables } from '@dataconnect/generated';

// The `GetPersonaBeliefsByPersonaId` query requires an argument of type `GetPersonaBeliefsByPersonaIdVariables`:
const getPersonaBeliefsByPersonaIdVars: GetPersonaBeliefsByPersonaIdVariables = {
  personaId: ..., 
};

// Call the `getPersonaBeliefsByPersonaId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPersonaBeliefsByPersonaId(getPersonaBeliefsByPersonaIdVars);
// Variables can be defined inline as well.
const { data } = await getPersonaBeliefsByPersonaId({ personaId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPersonaBeliefsByPersonaId(dataConnect, getPersonaBeliefsByPersonaIdVars);

console.log(data.personaBeliefs);

// Or, you can use the `Promise` API.
getPersonaBeliefsByPersonaId(getPersonaBeliefsByPersonaIdVars).then((response) => {
  const data = response.data;
  console.log(data.personaBeliefs);
});
```

### Using `GetPersonaBeliefsByPersonaId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPersonaBeliefsByPersonaIdRef, GetPersonaBeliefsByPersonaIdVariables } from '@dataconnect/generated';

// The `GetPersonaBeliefsByPersonaId` query requires an argument of type `GetPersonaBeliefsByPersonaIdVariables`:
const getPersonaBeliefsByPersonaIdVars: GetPersonaBeliefsByPersonaIdVariables = {
  personaId: ..., 
};

// Call the `getPersonaBeliefsByPersonaIdRef()` function to get a reference to the query.
const ref = getPersonaBeliefsByPersonaIdRef(getPersonaBeliefsByPersonaIdVars);
// Variables can be defined inline as well.
const ref = getPersonaBeliefsByPersonaIdRef({ personaId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPersonaBeliefsByPersonaIdRef(dataConnect, getPersonaBeliefsByPersonaIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personaBeliefs);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personaBeliefs);
});
```

## GetPersonaBeliefHistoryByTopicId
You can execute the `GetPersonaBeliefHistoryByTopicId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPersonaBeliefHistoryByTopicId(vars: GetPersonaBeliefHistoryByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;

interface GetPersonaBeliefHistoryByTopicIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaBeliefHistoryByTopicIdVariables): QueryRef<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;
}
export const getPersonaBeliefHistoryByTopicIdRef: GetPersonaBeliefHistoryByTopicIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPersonaBeliefHistoryByTopicId(dc: DataConnect, vars: GetPersonaBeliefHistoryByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;

interface GetPersonaBeliefHistoryByTopicIdRef {
  ...
  (dc: DataConnect, vars: GetPersonaBeliefHistoryByTopicIdVariables): QueryRef<GetPersonaBeliefHistoryByTopicIdData, GetPersonaBeliefHistoryByTopicIdVariables>;
}
export const getPersonaBeliefHistoryByTopicIdRef: GetPersonaBeliefHistoryByTopicIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPersonaBeliefHistoryByTopicIdRef:
```typescript
const name = getPersonaBeliefHistoryByTopicIdRef.operationName;
console.log(name);
```

### Variables
The `GetPersonaBeliefHistoryByTopicId` query requires an argument of type `GetPersonaBeliefHistoryByTopicIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPersonaBeliefHistoryByTopicIdVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPersonaBeliefHistoryByTopicId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPersonaBeliefHistoryByTopicIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPersonaBeliefHistoryByTopicId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPersonaBeliefHistoryByTopicId, GetPersonaBeliefHistoryByTopicIdVariables } from '@dataconnect/generated';

// The `GetPersonaBeliefHistoryByTopicId` query requires an argument of type `GetPersonaBeliefHistoryByTopicIdVariables`:
const getPersonaBeliefHistoryByTopicIdVars: GetPersonaBeliefHistoryByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getPersonaBeliefHistoryByTopicId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPersonaBeliefHistoryByTopicId(getPersonaBeliefHistoryByTopicIdVars);
// Variables can be defined inline as well.
const { data } = await getPersonaBeliefHistoryByTopicId({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPersonaBeliefHistoryByTopicId(dataConnect, getPersonaBeliefHistoryByTopicIdVars);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
getPersonaBeliefHistoryByTopicId(getPersonaBeliefHistoryByTopicIdVars).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

### Using `GetPersonaBeliefHistoryByTopicId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPersonaBeliefHistoryByTopicIdRef, GetPersonaBeliefHistoryByTopicIdVariables } from '@dataconnect/generated';

// The `GetPersonaBeliefHistoryByTopicId` query requires an argument of type `GetPersonaBeliefHistoryByTopicIdVariables`:
const getPersonaBeliefHistoryByTopicIdVars: GetPersonaBeliefHistoryByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getPersonaBeliefHistoryByTopicIdRef()` function to get a reference to the query.
const ref = getPersonaBeliefHistoryByTopicIdRef(getPersonaBeliefHistoryByTopicIdVars);
// Variables can be defined inline as well.
const ref = getPersonaBeliefHistoryByTopicIdRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPersonaBeliefHistoryByTopicIdRef(dataConnect, getPersonaBeliefHistoryByTopicIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personaProfiles);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personaProfiles);
});
```

## GetDebateSessionByTopicId
You can execute the `GetDebateSessionByTopicId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getDebateSessionByTopicId(vars: GetDebateSessionByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;

interface GetDebateSessionByTopicIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetDebateSessionByTopicIdVariables): QueryRef<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;
}
export const getDebateSessionByTopicIdRef: GetDebateSessionByTopicIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getDebateSessionByTopicId(dc: DataConnect, vars: GetDebateSessionByTopicIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;

interface GetDebateSessionByTopicIdRef {
  ...
  (dc: DataConnect, vars: GetDebateSessionByTopicIdVariables): QueryRef<GetDebateSessionByTopicIdData, GetDebateSessionByTopicIdVariables>;
}
export const getDebateSessionByTopicIdRef: GetDebateSessionByTopicIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getDebateSessionByTopicIdRef:
```typescript
const name = getDebateSessionByTopicIdRef.operationName;
console.log(name);
```

### Variables
The `GetDebateSessionByTopicId` query requires an argument of type `GetDebateSessionByTopicIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetDebateSessionByTopicIdVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `GetDebateSessionByTopicId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetDebateSessionByTopicIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetDebateSessionByTopicId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getDebateSessionByTopicId, GetDebateSessionByTopicIdVariables } from '@dataconnect/generated';

// The `GetDebateSessionByTopicId` query requires an argument of type `GetDebateSessionByTopicIdVariables`:
const getDebateSessionByTopicIdVars: GetDebateSessionByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getDebateSessionByTopicId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getDebateSessionByTopicId(getDebateSessionByTopicIdVars);
// Variables can be defined inline as well.
const { data } = await getDebateSessionByTopicId({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getDebateSessionByTopicId(dataConnect, getDebateSessionByTopicIdVars);

console.log(data.debateSessions);

// Or, you can use the `Promise` API.
getDebateSessionByTopicId(getDebateSessionByTopicIdVars).then((response) => {
  const data = response.data;
  console.log(data.debateSessions);
});
```

### Using `GetDebateSessionByTopicId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getDebateSessionByTopicIdRef, GetDebateSessionByTopicIdVariables } from '@dataconnect/generated';

// The `GetDebateSessionByTopicId` query requires an argument of type `GetDebateSessionByTopicIdVariables`:
const getDebateSessionByTopicIdVars: GetDebateSessionByTopicIdVariables = {
  topicId: ..., 
};

// Call the `getDebateSessionByTopicIdRef()` function to get a reference to the query.
const ref = getDebateSessionByTopicIdRef(getDebateSessionByTopicIdVars);
// Variables can be defined inline as well.
const ref = getDebateSessionByTopicIdRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getDebateSessionByTopicIdRef(dataConnect, getDebateSessionByTopicIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateSessions);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSessions);
});
```

## GetDebateTurnsBySessionId
You can execute the `GetDebateTurnsBySessionId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getDebateTurnsBySessionId(vars: GetDebateTurnsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;

interface GetDebateTurnsBySessionIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetDebateTurnsBySessionIdVariables): QueryRef<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;
}
export const getDebateTurnsBySessionIdRef: GetDebateTurnsBySessionIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getDebateTurnsBySessionId(dc: DataConnect, vars: GetDebateTurnsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;

interface GetDebateTurnsBySessionIdRef {
  ...
  (dc: DataConnect, vars: GetDebateTurnsBySessionIdVariables): QueryRef<GetDebateTurnsBySessionIdData, GetDebateTurnsBySessionIdVariables>;
}
export const getDebateTurnsBySessionIdRef: GetDebateTurnsBySessionIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getDebateTurnsBySessionIdRef:
```typescript
const name = getDebateTurnsBySessionIdRef.operationName;
console.log(name);
```

### Variables
The `GetDebateTurnsBySessionId` query requires an argument of type `GetDebateTurnsBySessionIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetDebateTurnsBySessionIdVariables {
  sessionId: UUIDString;
}
```
### Return Type
Recall that executing the `GetDebateTurnsBySessionId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetDebateTurnsBySessionIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetDebateTurnsBySessionId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getDebateTurnsBySessionId, GetDebateTurnsBySessionIdVariables } from '@dataconnect/generated';

// The `GetDebateTurnsBySessionId` query requires an argument of type `GetDebateTurnsBySessionIdVariables`:
const getDebateTurnsBySessionIdVars: GetDebateTurnsBySessionIdVariables = {
  sessionId: ..., 
};

// Call the `getDebateTurnsBySessionId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getDebateTurnsBySessionId(getDebateTurnsBySessionIdVars);
// Variables can be defined inline as well.
const { data } = await getDebateTurnsBySessionId({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getDebateTurnsBySessionId(dataConnect, getDebateTurnsBySessionIdVars);

console.log(data.debateTurns);

// Or, you can use the `Promise` API.
getDebateTurnsBySessionId(getDebateTurnsBySessionIdVars).then((response) => {
  const data = response.data;
  console.log(data.debateTurns);
});
```

### Using `GetDebateTurnsBySessionId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getDebateTurnsBySessionIdRef, GetDebateTurnsBySessionIdVariables } from '@dataconnect/generated';

// The `GetDebateTurnsBySessionId` query requires an argument of type `GetDebateTurnsBySessionIdVariables`:
const getDebateTurnsBySessionIdVars: GetDebateTurnsBySessionIdVariables = {
  sessionId: ..., 
};

// Call the `getDebateTurnsBySessionIdRef()` function to get a reference to the query.
const ref = getDebateTurnsBySessionIdRef(getDebateTurnsBySessionIdVars);
// Variables can be defined inline as well.
const ref = getDebateTurnsBySessionIdRef({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getDebateTurnsBySessionIdRef(dataConnect, getDebateTurnsBySessionIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateTurns);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTurns);
});
```

## GetPostDebateCommentsBySessionId
You can execute the `GetPostDebateCommentsBySessionId` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPostDebateCommentsBySessionId(vars: GetPostDebateCommentsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;

interface GetPostDebateCommentsBySessionIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPostDebateCommentsBySessionIdVariables): QueryRef<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;
}
export const getPostDebateCommentsBySessionIdRef: GetPostDebateCommentsBySessionIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPostDebateCommentsBySessionId(dc: DataConnect, vars: GetPostDebateCommentsBySessionIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;

interface GetPostDebateCommentsBySessionIdRef {
  ...
  (dc: DataConnect, vars: GetPostDebateCommentsBySessionIdVariables): QueryRef<GetPostDebateCommentsBySessionIdData, GetPostDebateCommentsBySessionIdVariables>;
}
export const getPostDebateCommentsBySessionIdRef: GetPostDebateCommentsBySessionIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPostDebateCommentsBySessionIdRef:
```typescript
const name = getPostDebateCommentsBySessionIdRef.operationName;
console.log(name);
```

### Variables
The `GetPostDebateCommentsBySessionId` query requires an argument of type `GetPostDebateCommentsBySessionIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPostDebateCommentsBySessionIdVariables {
  sessionId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPostDebateCommentsBySessionId` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPostDebateCommentsBySessionIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetPostDebateCommentsBySessionIdData {
  postDebateComments: ({
    id: UUIDString;
    sessionId: UUIDString;
    personaId: UUIDString;
    content: string;
    sortOrder: number;
  } & PostDebateComment_Key)[];
}
```
### Using `GetPostDebateCommentsBySessionId`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPostDebateCommentsBySessionId, GetPostDebateCommentsBySessionIdVariables } from '@dataconnect/generated';

// The `GetPostDebateCommentsBySessionId` query requires an argument of type `GetPostDebateCommentsBySessionIdVariables`:
const getPostDebateCommentsBySessionIdVars: GetPostDebateCommentsBySessionIdVariables = {
  sessionId: ..., 
};

// Call the `getPostDebateCommentsBySessionId()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPostDebateCommentsBySessionId(getPostDebateCommentsBySessionIdVars);
// Variables can be defined inline as well.
const { data } = await getPostDebateCommentsBySessionId({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPostDebateCommentsBySessionId(dataConnect, getPostDebateCommentsBySessionIdVars);

console.log(data.postDebateComments);

// Or, you can use the `Promise` API.
getPostDebateCommentsBySessionId(getPostDebateCommentsBySessionIdVars).then((response) => {
  const data = response.data;
  console.log(data.postDebateComments);
});
```

### Using `GetPostDebateCommentsBySessionId`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPostDebateCommentsBySessionIdRef, GetPostDebateCommentsBySessionIdVariables } from '@dataconnect/generated';

// The `GetPostDebateCommentsBySessionId` query requires an argument of type `GetPostDebateCommentsBySessionIdVariables`:
const getPostDebateCommentsBySessionIdVars: GetPostDebateCommentsBySessionIdVariables = {
  sessionId: ..., 
};

// Call the `getPostDebateCommentsBySessionIdRef()` function to get a reference to the query.
const ref = getPostDebateCommentsBySessionIdRef(getPostDebateCommentsBySessionIdVars);
// Variables can be defined inline as well.
const ref = getPostDebateCommentsBySessionIdRef({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPostDebateCommentsBySessionIdRef(dataConnect, getPostDebateCommentsBySessionIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.postDebateComments);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.postDebateComments);
});
```

## GetPublishedDebates
You can execute the `GetPublishedDebates` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPublishedDebates(options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebatesData, undefined>;

interface GetPublishedDebatesRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetPublishedDebatesData, undefined>;
}
export const getPublishedDebatesRef: GetPublishedDebatesRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPublishedDebates(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebatesData, undefined>;

interface GetPublishedDebatesRef {
  ...
  (dc: DataConnect): QueryRef<GetPublishedDebatesData, undefined>;
}
export const getPublishedDebatesRef: GetPublishedDebatesRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPublishedDebatesRef:
```typescript
const name = getPublishedDebatesRef.operationName;
console.log(name);
```

### Variables
The `GetPublishedDebates` query has no variables.
### Return Type
Recall that executing the `GetPublishedDebates` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPublishedDebatesData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPublishedDebates`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPublishedDebates } from '@dataconnect/generated';


// Call the `getPublishedDebates()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPublishedDebates();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPublishedDebates(dataConnect);

console.log(data.debateSessions);

// Or, you can use the `Promise` API.
getPublishedDebates().then((response) => {
  const data = response.data;
  console.log(data.debateSessions);
});
```

### Using `GetPublishedDebates`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPublishedDebatesRef } from '@dataconnect/generated';


// Call the `getPublishedDebatesRef()` function to get a reference to the query.
const ref = getPublishedDebatesRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPublishedDebatesRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateSessions);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSessions);
});
```

## GetPublishedDebateById
You can execute the `GetPublishedDebateById` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getPublishedDebateById(vars: GetPublishedDebateByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;

interface GetPublishedDebateByIdRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPublishedDebateByIdVariables): QueryRef<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;
}
export const getPublishedDebateByIdRef: GetPublishedDebateByIdRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPublishedDebateById(dc: DataConnect, vars: GetPublishedDebateByIdVariables, options?: ExecuteQueryOptions): QueryPromise<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;

interface GetPublishedDebateByIdRef {
  ...
  (dc: DataConnect, vars: GetPublishedDebateByIdVariables): QueryRef<GetPublishedDebateByIdData, GetPublishedDebateByIdVariables>;
}
export const getPublishedDebateByIdRef: GetPublishedDebateByIdRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPublishedDebateByIdRef:
```typescript
const name = getPublishedDebateByIdRef.operationName;
console.log(name);
```

### Variables
The `GetPublishedDebateById` query requires an argument of type `GetPublishedDebateByIdVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPublishedDebateByIdVariables {
  sessionId: UUIDString;
}
```
### Return Type
Recall that executing the `GetPublishedDebateById` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPublishedDebateByIdData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPublishedDebateById`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPublishedDebateById, GetPublishedDebateByIdVariables } from '@dataconnect/generated';

// The `GetPublishedDebateById` query requires an argument of type `GetPublishedDebateByIdVariables`:
const getPublishedDebateByIdVars: GetPublishedDebateByIdVariables = {
  sessionId: ..., 
};

// Call the `getPublishedDebateById()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPublishedDebateById(getPublishedDebateByIdVars);
// Variables can be defined inline as well.
const { data } = await getPublishedDebateById({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPublishedDebateById(dataConnect, getPublishedDebateByIdVars);

console.log(data.debateSession);

// Or, you can use the `Promise` API.
getPublishedDebateById(getPublishedDebateByIdVars).then((response) => {
  const data = response.data;
  console.log(data.debateSession);
});
```

### Using `GetPublishedDebateById`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPublishedDebateByIdRef, GetPublishedDebateByIdVariables } from '@dataconnect/generated';

// The `GetPublishedDebateById` query requires an argument of type `GetPublishedDebateByIdVariables`:
const getPublishedDebateByIdVars: GetPublishedDebateByIdVariables = {
  sessionId: ..., 
};

// Call the `getPublishedDebateByIdRef()` function to get a reference to the query.
const ref = getPublishedDebateByIdRef(getPublishedDebateByIdVars);
// Variables can be defined inline as well.
const ref = getPublishedDebateByIdRef({ sessionId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPublishedDebateByIdRef(dataConnect, getPublishedDebateByIdVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.debateSession);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSession);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `logotope` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateDebateTopic
You can execute the `CreateDebateTopic` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createDebateTopic(vars: CreateDebateTopicVariables): MutationPromise<CreateDebateTopicData, CreateDebateTopicVariables>;

interface CreateDebateTopicRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateTopicVariables): MutationRef<CreateDebateTopicData, CreateDebateTopicVariables>;
}
export const createDebateTopicRef: CreateDebateTopicRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createDebateTopic(dc: DataConnect, vars: CreateDebateTopicVariables): MutationPromise<CreateDebateTopicData, CreateDebateTopicVariables>;

interface CreateDebateTopicRef {
  ...
  (dc: DataConnect, vars: CreateDebateTopicVariables): MutationRef<CreateDebateTopicData, CreateDebateTopicVariables>;
}
export const createDebateTopicRef: CreateDebateTopicRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createDebateTopicRef:
```typescript
const name = createDebateTopicRef.operationName;
console.log(name);
```

### Variables
The `CreateDebateTopic` mutation requires an argument of type `CreateDebateTopicVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateDebateTopicVariables {
  title: string;
}
```
### Return Type
Recall that executing the `CreateDebateTopic` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateDebateTopicData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateDebateTopicData {
  debateTopic_insert: DebateTopic_Key;
}
```
### Using `CreateDebateTopic`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createDebateTopic, CreateDebateTopicVariables } from '@dataconnect/generated';

// The `CreateDebateTopic` mutation requires an argument of type `CreateDebateTopicVariables`:
const createDebateTopicVars: CreateDebateTopicVariables = {
  title: ..., 
};

// Call the `createDebateTopic()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createDebateTopic(createDebateTopicVars);
// Variables can be defined inline as well.
const { data } = await createDebateTopic({ title: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createDebateTopic(dataConnect, createDebateTopicVars);

console.log(data.debateTopic_insert);

// Or, you can use the `Promise` API.
createDebateTopic(createDebateTopicVars).then((response) => {
  const data = response.data;
  console.log(data.debateTopic_insert);
});
```

### Using `CreateDebateTopic`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createDebateTopicRef, CreateDebateTopicVariables } from '@dataconnect/generated';

// The `CreateDebateTopic` mutation requires an argument of type `CreateDebateTopicVariables`:
const createDebateTopicVars: CreateDebateTopicVariables = {
  title: ..., 
};

// Call the `createDebateTopicRef()` function to get a reference to the mutation.
const ref = createDebateTopicRef(createDebateTopicVars);
// Variables can be defined inline as well.
const ref = createDebateTopicRef({ title: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createDebateTopicRef(dataConnect, createDebateTopicVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateTopic_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTopic_insert);
});
```

## UpdateDebateTopicStatus
You can execute the `UpdateDebateTopicStatus` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updateDebateTopicStatus(vars: UpdateDebateTopicStatusVariables): MutationPromise<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;

interface UpdateDebateTopicStatusRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateDebateTopicStatusVariables): MutationRef<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;
}
export const updateDebateTopicStatusRef: UpdateDebateTopicStatusRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateDebateTopicStatus(dc: DataConnect, vars: UpdateDebateTopicStatusVariables): MutationPromise<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;

interface UpdateDebateTopicStatusRef {
  ...
  (dc: DataConnect, vars: UpdateDebateTopicStatusVariables): MutationRef<UpdateDebateTopicStatusData, UpdateDebateTopicStatusVariables>;
}
export const updateDebateTopicStatusRef: UpdateDebateTopicStatusRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateDebateTopicStatusRef:
```typescript
const name = updateDebateTopicStatusRef.operationName;
console.log(name);
```

### Variables
The `UpdateDebateTopicStatus` mutation requires an argument of type `UpdateDebateTopicStatusVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateDebateTopicStatusVariables {
  id: UUIDString;
  status: string;
}
```
### Return Type
Recall that executing the `UpdateDebateTopicStatus` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateDebateTopicStatusData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateDebateTopicStatusData {
  debateTopic_update?: DebateTopic_Key | null;
}
```
### Using `UpdateDebateTopicStatus`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateDebateTopicStatus, UpdateDebateTopicStatusVariables } from '@dataconnect/generated';

// The `UpdateDebateTopicStatus` mutation requires an argument of type `UpdateDebateTopicStatusVariables`:
const updateDebateTopicStatusVars: UpdateDebateTopicStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateDebateTopicStatus()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateDebateTopicStatus(updateDebateTopicStatusVars);
// Variables can be defined inline as well.
const { data } = await updateDebateTopicStatus({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateDebateTopicStatus(dataConnect, updateDebateTopicStatusVars);

console.log(data.debateTopic_update);

// Or, you can use the `Promise` API.
updateDebateTopicStatus(updateDebateTopicStatusVars).then((response) => {
  const data = response.data;
  console.log(data.debateTopic_update);
});
```

### Using `UpdateDebateTopicStatus`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateDebateTopicStatusRef, UpdateDebateTopicStatusVariables } from '@dataconnect/generated';

// The `UpdateDebateTopicStatus` mutation requires an argument of type `UpdateDebateTopicStatusVariables`:
const updateDebateTopicStatusVars: UpdateDebateTopicStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateDebateTopicStatusRef()` function to get a reference to the mutation.
const ref = updateDebateTopicStatusRef(updateDebateTopicStatusVars);
// Variables can be defined inline as well.
const ref = updateDebateTopicStatusRef({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateDebateTopicStatusRef(dataConnect, updateDebateTopicStatusVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateTopic_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTopic_update);
});
```

## CreateStakeholderMap
You can execute the `CreateStakeholderMap` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createStakeholderMap(vars: CreateStakeholderMapVariables): MutationPromise<CreateStakeholderMapData, CreateStakeholderMapVariables>;

interface CreateStakeholderMapRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateStakeholderMapVariables): MutationRef<CreateStakeholderMapData, CreateStakeholderMapVariables>;
}
export const createStakeholderMapRef: CreateStakeholderMapRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createStakeholderMap(dc: DataConnect, vars: CreateStakeholderMapVariables): MutationPromise<CreateStakeholderMapData, CreateStakeholderMapVariables>;

interface CreateStakeholderMapRef {
  ...
  (dc: DataConnect, vars: CreateStakeholderMapVariables): MutationRef<CreateStakeholderMapData, CreateStakeholderMapVariables>;
}
export const createStakeholderMapRef: CreateStakeholderMapRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createStakeholderMapRef:
```typescript
const name = createStakeholderMapRef.operationName;
console.log(name);
```

### Variables
The `CreateStakeholderMap` mutation requires an argument of type `CreateStakeholderMapVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateStakeholderMapVariables {
  topicId: UUIDString;
  content: string;
}
```
### Return Type
Recall that executing the `CreateStakeholderMap` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateStakeholderMapData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateStakeholderMapData {
  stakeholderMap_insert: StakeholderMap_Key;
}
```
### Using `CreateStakeholderMap`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createStakeholderMap, CreateStakeholderMapVariables } from '@dataconnect/generated';

// The `CreateStakeholderMap` mutation requires an argument of type `CreateStakeholderMapVariables`:
const createStakeholderMapVars: CreateStakeholderMapVariables = {
  topicId: ..., 
  content: ..., 
};

// Call the `createStakeholderMap()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createStakeholderMap(createStakeholderMapVars);
// Variables can be defined inline as well.
const { data } = await createStakeholderMap({ topicId: ..., content: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createStakeholderMap(dataConnect, createStakeholderMapVars);

console.log(data.stakeholderMap_insert);

// Or, you can use the `Promise` API.
createStakeholderMap(createStakeholderMapVars).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMap_insert);
});
```

### Using `CreateStakeholderMap`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createStakeholderMapRef, CreateStakeholderMapVariables } from '@dataconnect/generated';

// The `CreateStakeholderMap` mutation requires an argument of type `CreateStakeholderMapVariables`:
const createStakeholderMapVars: CreateStakeholderMapVariables = {
  topicId: ..., 
  content: ..., 
};

// Call the `createStakeholderMapRef()` function to get a reference to the mutation.
const ref = createStakeholderMapRef(createStakeholderMapVars);
// Variables can be defined inline as well.
const ref = createStakeholderMapRef({ topicId: ..., content: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createStakeholderMapRef(dataConnect, createStakeholderMapVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.stakeholderMap_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMap_insert);
});
```

## ApproveStakeholderMap
You can execute the `ApproveStakeholderMap` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
approveStakeholderMap(vars: ApproveStakeholderMapVariables): MutationPromise<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;

interface ApproveStakeholderMapRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ApproveStakeholderMapVariables): MutationRef<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;
}
export const approveStakeholderMapRef: ApproveStakeholderMapRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
approveStakeholderMap(dc: DataConnect, vars: ApproveStakeholderMapVariables): MutationPromise<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;

interface ApproveStakeholderMapRef {
  ...
  (dc: DataConnect, vars: ApproveStakeholderMapVariables): MutationRef<ApproveStakeholderMapData, ApproveStakeholderMapVariables>;
}
export const approveStakeholderMapRef: ApproveStakeholderMapRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the approveStakeholderMapRef:
```typescript
const name = approveStakeholderMapRef.operationName;
console.log(name);
```

### Variables
The `ApproveStakeholderMap` mutation requires an argument of type `ApproveStakeholderMapVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ApproveStakeholderMapVariables {
  id: UUIDString;
}
```
### Return Type
Recall that executing the `ApproveStakeholderMap` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ApproveStakeholderMapData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ApproveStakeholderMapData {
  stakeholderMap_update?: StakeholderMap_Key | null;
}
```
### Using `ApproveStakeholderMap`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, approveStakeholderMap, ApproveStakeholderMapVariables } from '@dataconnect/generated';

// The `ApproveStakeholderMap` mutation requires an argument of type `ApproveStakeholderMapVariables`:
const approveStakeholderMapVars: ApproveStakeholderMapVariables = {
  id: ..., 
};

// Call the `approveStakeholderMap()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await approveStakeholderMap(approveStakeholderMapVars);
// Variables can be defined inline as well.
const { data } = await approveStakeholderMap({ id: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await approveStakeholderMap(dataConnect, approveStakeholderMapVars);

console.log(data.stakeholderMap_update);

// Or, you can use the `Promise` API.
approveStakeholderMap(approveStakeholderMapVars).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMap_update);
});
```

### Using `ApproveStakeholderMap`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, approveStakeholderMapRef, ApproveStakeholderMapVariables } from '@dataconnect/generated';

// The `ApproveStakeholderMap` mutation requires an argument of type `ApproveStakeholderMapVariables`:
const approveStakeholderMapVars: ApproveStakeholderMapVariables = {
  id: ..., 
};

// Call the `approveStakeholderMapRef()` function to get a reference to the mutation.
const ref = approveStakeholderMapRef(approveStakeholderMapVars);
// Variables can be defined inline as well.
const ref = approveStakeholderMapRef({ id: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = approveStakeholderMapRef(dataConnect, approveStakeholderMapVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.stakeholderMap_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.stakeholderMap_update);
});
```

## CreatePersonaProfile
You can execute the `CreatePersonaProfile` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createPersonaProfile(vars: CreatePersonaProfileVariables): MutationPromise<CreatePersonaProfileData, CreatePersonaProfileVariables>;

interface CreatePersonaProfileRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaProfileVariables): MutationRef<CreatePersonaProfileData, CreatePersonaProfileVariables>;
}
export const createPersonaProfileRef: CreatePersonaProfileRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createPersonaProfile(dc: DataConnect, vars: CreatePersonaProfileVariables): MutationPromise<CreatePersonaProfileData, CreatePersonaProfileVariables>;

interface CreatePersonaProfileRef {
  ...
  (dc: DataConnect, vars: CreatePersonaProfileVariables): MutationRef<CreatePersonaProfileData, CreatePersonaProfileVariables>;
}
export const createPersonaProfileRef: CreatePersonaProfileRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createPersonaProfileRef:
```typescript
const name = createPersonaProfileRef.operationName;
console.log(name);
```

### Variables
The `CreatePersonaProfile` mutation requires an argument of type `CreatePersonaProfileVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
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
```
### Return Type
Recall that executing the `CreatePersonaProfile` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreatePersonaProfileData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreatePersonaProfileData {
  personaProfile_insert: PersonaProfile_Key;
}
```
### Using `CreatePersonaProfile`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createPersonaProfile, CreatePersonaProfileVariables } from '@dataconnect/generated';

// The `CreatePersonaProfile` mutation requires an argument of type `CreatePersonaProfileVariables`:
const createPersonaProfileVars: CreatePersonaProfileVariables = {
  topicId: ..., 
  stakeholderRole: ..., 
  name: ..., 
  age: ..., 
  occupation: ..., 
  background: ..., 
  interests: ..., 
  stanceDirection: ..., 
  sortOrder: ..., 
};

// Call the `createPersonaProfile()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createPersonaProfile(createPersonaProfileVars);
// Variables can be defined inline as well.
const { data } = await createPersonaProfile({ topicId: ..., stakeholderRole: ..., name: ..., age: ..., occupation: ..., background: ..., interests: ..., stanceDirection: ..., sortOrder: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createPersonaProfile(dataConnect, createPersonaProfileVars);

console.log(data.personaProfile_insert);

// Or, you can use the `Promise` API.
createPersonaProfile(createPersonaProfileVars).then((response) => {
  const data = response.data;
  console.log(data.personaProfile_insert);
});
```

### Using `CreatePersonaProfile`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createPersonaProfileRef, CreatePersonaProfileVariables } from '@dataconnect/generated';

// The `CreatePersonaProfile` mutation requires an argument of type `CreatePersonaProfileVariables`:
const createPersonaProfileVars: CreatePersonaProfileVariables = {
  topicId: ..., 
  stakeholderRole: ..., 
  name: ..., 
  age: ..., 
  occupation: ..., 
  background: ..., 
  interests: ..., 
  stanceDirection: ..., 
  sortOrder: ..., 
};

// Call the `createPersonaProfileRef()` function to get a reference to the mutation.
const ref = createPersonaProfileRef(createPersonaProfileVars);
// Variables can be defined inline as well.
const ref = createPersonaProfileRef({ topicId: ..., stakeholderRole: ..., name: ..., age: ..., occupation: ..., background: ..., interests: ..., stanceDirection: ..., sortOrder: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createPersonaProfileRef(dataConnect, createPersonaProfileVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaProfile_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaProfile_insert);
});
```

## ApprovePersonaProfiles
You can execute the `ApprovePersonaProfiles` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
approvePersonaProfiles(vars: ApprovePersonaProfilesVariables): MutationPromise<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;

interface ApprovePersonaProfilesRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ApprovePersonaProfilesVariables): MutationRef<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;
}
export const approvePersonaProfilesRef: ApprovePersonaProfilesRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
approvePersonaProfiles(dc: DataConnect, vars: ApprovePersonaProfilesVariables): MutationPromise<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;

interface ApprovePersonaProfilesRef {
  ...
  (dc: DataConnect, vars: ApprovePersonaProfilesVariables): MutationRef<ApprovePersonaProfilesData, ApprovePersonaProfilesVariables>;
}
export const approvePersonaProfilesRef: ApprovePersonaProfilesRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the approvePersonaProfilesRef:
```typescript
const name = approvePersonaProfilesRef.operationName;
console.log(name);
```

### Variables
The `ApprovePersonaProfiles` mutation requires an argument of type `ApprovePersonaProfilesVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ApprovePersonaProfilesVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `ApprovePersonaProfiles` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ApprovePersonaProfilesData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ApprovePersonaProfilesData {
  personaProfile_updateMany: number;
}
```
### Using `ApprovePersonaProfiles`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, approvePersonaProfiles, ApprovePersonaProfilesVariables } from '@dataconnect/generated';

// The `ApprovePersonaProfiles` mutation requires an argument of type `ApprovePersonaProfilesVariables`:
const approvePersonaProfilesVars: ApprovePersonaProfilesVariables = {
  topicId: ..., 
};

// Call the `approvePersonaProfiles()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await approvePersonaProfiles(approvePersonaProfilesVars);
// Variables can be defined inline as well.
const { data } = await approvePersonaProfiles({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await approvePersonaProfiles(dataConnect, approvePersonaProfilesVars);

console.log(data.personaProfile_updateMany);

// Or, you can use the `Promise` API.
approvePersonaProfiles(approvePersonaProfilesVars).then((response) => {
  const data = response.data;
  console.log(data.personaProfile_updateMany);
});
```

### Using `ApprovePersonaProfiles`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, approvePersonaProfilesRef, ApprovePersonaProfilesVariables } from '@dataconnect/generated';

// The `ApprovePersonaProfiles` mutation requires an argument of type `ApprovePersonaProfilesVariables`:
const approvePersonaProfilesVars: ApprovePersonaProfilesVariables = {
  topicId: ..., 
};

// Call the `approvePersonaProfilesRef()` function to get a reference to the mutation.
const ref = approvePersonaProfilesRef(approvePersonaProfilesVars);
// Variables can be defined inline as well.
const ref = approvePersonaProfilesRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = approvePersonaProfilesRef(dataConnect, approvePersonaProfilesVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaProfile_updateMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaProfile_updateMany);
});
```

## CreatePersonaInterview
You can execute the `CreatePersonaInterview` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createPersonaInterview(vars: CreatePersonaInterviewVariables): MutationPromise<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;

interface CreatePersonaInterviewRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaInterviewVariables): MutationRef<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;
}
export const createPersonaInterviewRef: CreatePersonaInterviewRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createPersonaInterview(dc: DataConnect, vars: CreatePersonaInterviewVariables): MutationPromise<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;

interface CreatePersonaInterviewRef {
  ...
  (dc: DataConnect, vars: CreatePersonaInterviewVariables): MutationRef<CreatePersonaInterviewData, CreatePersonaInterviewVariables>;
}
export const createPersonaInterviewRef: CreatePersonaInterviewRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createPersonaInterviewRef:
```typescript
const name = createPersonaInterviewRef.operationName;
console.log(name);
```

### Variables
The `CreatePersonaInterview` mutation requires an argument of type `CreatePersonaInterviewVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreatePersonaInterviewVariables {
  personaId: UUIDString;
  interviewRecord: string;
}
```
### Return Type
Recall that executing the `CreatePersonaInterview` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreatePersonaInterviewData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreatePersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}
```
### Using `CreatePersonaInterview`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createPersonaInterview, CreatePersonaInterviewVariables } from '@dataconnect/generated';

// The `CreatePersonaInterview` mutation requires an argument of type `CreatePersonaInterviewVariables`:
const createPersonaInterviewVars: CreatePersonaInterviewVariables = {
  personaId: ..., 
  interviewRecord: ..., 
};

// Call the `createPersonaInterview()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createPersonaInterview(createPersonaInterviewVars);
// Variables can be defined inline as well.
const { data } = await createPersonaInterview({ personaId: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createPersonaInterview(dataConnect, createPersonaInterviewVars);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
createPersonaInterview(createPersonaInterviewVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

### Using `CreatePersonaInterview`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createPersonaInterviewRef, CreatePersonaInterviewVariables } from '@dataconnect/generated';

// The `CreatePersonaInterview` mutation requires an argument of type `CreatePersonaInterviewVariables`:
const createPersonaInterviewVars: CreatePersonaInterviewVariables = {
  personaId: ..., 
  interviewRecord: ..., 
};

// Call the `createPersonaInterviewRef()` function to get a reference to the mutation.
const ref = createPersonaInterviewRef(createPersonaInterviewVars);
// Variables can be defined inline as well.
const ref = createPersonaInterviewRef({ personaId: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createPersonaInterviewRef(dataConnect, createPersonaInterviewVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

## CreateCompletedPersonaInterview
You can execute the `CreateCompletedPersonaInterview` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createCompletedPersonaInterview(vars: CreateCompletedPersonaInterviewVariables): MutationPromise<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;

interface CreateCompletedPersonaInterviewRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateCompletedPersonaInterviewVariables): MutationRef<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;
}
export const createCompletedPersonaInterviewRef: CreateCompletedPersonaInterviewRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createCompletedPersonaInterview(dc: DataConnect, vars: CreateCompletedPersonaInterviewVariables): MutationPromise<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;

interface CreateCompletedPersonaInterviewRef {
  ...
  (dc: DataConnect, vars: CreateCompletedPersonaInterviewVariables): MutationRef<CreateCompletedPersonaInterviewData, CreateCompletedPersonaInterviewVariables>;
}
export const createCompletedPersonaInterviewRef: CreateCompletedPersonaInterviewRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createCompletedPersonaInterviewRef:
```typescript
const name = createCompletedPersonaInterviewRef.operationName;
console.log(name);
```

### Variables
The `CreateCompletedPersonaInterview` mutation requires an argument of type `CreateCompletedPersonaInterviewVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateCompletedPersonaInterviewVariables {
  personaId: UUIDString;
  interviewRecord: string;
}
```
### Return Type
Recall that executing the `CreateCompletedPersonaInterview` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateCompletedPersonaInterviewData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateCompletedPersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}
```
### Using `CreateCompletedPersonaInterview`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createCompletedPersonaInterview, CreateCompletedPersonaInterviewVariables } from '@dataconnect/generated';

// The `CreateCompletedPersonaInterview` mutation requires an argument of type `CreateCompletedPersonaInterviewVariables`:
const createCompletedPersonaInterviewVars: CreateCompletedPersonaInterviewVariables = {
  personaId: ..., 
  interviewRecord: ..., 
};

// Call the `createCompletedPersonaInterview()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createCompletedPersonaInterview(createCompletedPersonaInterviewVars);
// Variables can be defined inline as well.
const { data } = await createCompletedPersonaInterview({ personaId: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createCompletedPersonaInterview(dataConnect, createCompletedPersonaInterviewVars);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
createCompletedPersonaInterview(createCompletedPersonaInterviewVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

### Using `CreateCompletedPersonaInterview`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createCompletedPersonaInterviewRef, CreateCompletedPersonaInterviewVariables } from '@dataconnect/generated';

// The `CreateCompletedPersonaInterview` mutation requires an argument of type `CreateCompletedPersonaInterviewVariables`:
const createCompletedPersonaInterviewVars: CreateCompletedPersonaInterviewVariables = {
  personaId: ..., 
  interviewRecord: ..., 
};

// Call the `createCompletedPersonaInterviewRef()` function to get a reference to the mutation.
const ref = createCompletedPersonaInterviewRef(createCompletedPersonaInterviewVars);
// Variables can be defined inline as well.
const ref = createCompletedPersonaInterviewRef({ personaId: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createCompletedPersonaInterviewRef(dataConnect, createCompletedPersonaInterviewVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

## CreateErrorPersonaInterview
You can execute the `CreateErrorPersonaInterview` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createErrorPersonaInterview(vars: CreateErrorPersonaInterviewVariables): MutationPromise<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;

interface CreateErrorPersonaInterviewRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateErrorPersonaInterviewVariables): MutationRef<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;
}
export const createErrorPersonaInterviewRef: CreateErrorPersonaInterviewRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createErrorPersonaInterview(dc: DataConnect, vars: CreateErrorPersonaInterviewVariables): MutationPromise<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;

interface CreateErrorPersonaInterviewRef {
  ...
  (dc: DataConnect, vars: CreateErrorPersonaInterviewVariables): MutationRef<CreateErrorPersonaInterviewData, CreateErrorPersonaInterviewVariables>;
}
export const createErrorPersonaInterviewRef: CreateErrorPersonaInterviewRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createErrorPersonaInterviewRef:
```typescript
const name = createErrorPersonaInterviewRef.operationName;
console.log(name);
```

### Variables
The `CreateErrorPersonaInterview` mutation requires an argument of type `CreateErrorPersonaInterviewVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateErrorPersonaInterviewVariables {
  personaId: UUIDString;
  errorMessage: string;
}
```
### Return Type
Recall that executing the `CreateErrorPersonaInterview` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateErrorPersonaInterviewData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateErrorPersonaInterviewData {
  personaInterview_insert: PersonaInterview_Key;
}
```
### Using `CreateErrorPersonaInterview`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createErrorPersonaInterview, CreateErrorPersonaInterviewVariables } from '@dataconnect/generated';

// The `CreateErrorPersonaInterview` mutation requires an argument of type `CreateErrorPersonaInterviewVariables`:
const createErrorPersonaInterviewVars: CreateErrorPersonaInterviewVariables = {
  personaId: ..., 
  errorMessage: ..., 
};

// Call the `createErrorPersonaInterview()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createErrorPersonaInterview(createErrorPersonaInterviewVars);
// Variables can be defined inline as well.
const { data } = await createErrorPersonaInterview({ personaId: ..., errorMessage: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createErrorPersonaInterview(dataConnect, createErrorPersonaInterviewVars);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
createErrorPersonaInterview(createErrorPersonaInterviewVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

### Using `CreateErrorPersonaInterview`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createErrorPersonaInterviewRef, CreateErrorPersonaInterviewVariables } from '@dataconnect/generated';

// The `CreateErrorPersonaInterview` mutation requires an argument of type `CreateErrorPersonaInterviewVariables`:
const createErrorPersonaInterviewVars: CreateErrorPersonaInterviewVariables = {
  personaId: ..., 
  errorMessage: ..., 
};

// Call the `createErrorPersonaInterviewRef()` function to get a reference to the mutation.
const ref = createErrorPersonaInterviewRef(createErrorPersonaInterviewVars);
// Variables can be defined inline as well.
const ref = createErrorPersonaInterviewRef({ personaId: ..., errorMessage: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createErrorPersonaInterviewRef(dataConnect, createErrorPersonaInterviewVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaInterview_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_insert);
});
```

## UpdatePersonaInterviewStatus
You can execute the `UpdatePersonaInterviewStatus` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updatePersonaInterviewStatus(vars: UpdatePersonaInterviewStatusVariables): MutationPromise<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;

interface UpdatePersonaInterviewStatusRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdatePersonaInterviewStatusVariables): MutationRef<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;
}
export const updatePersonaInterviewStatusRef: UpdatePersonaInterviewStatusRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updatePersonaInterviewStatus(dc: DataConnect, vars: UpdatePersonaInterviewStatusVariables): MutationPromise<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;

interface UpdatePersonaInterviewStatusRef {
  ...
  (dc: DataConnect, vars: UpdatePersonaInterviewStatusVariables): MutationRef<UpdatePersonaInterviewStatusData, UpdatePersonaInterviewStatusVariables>;
}
export const updatePersonaInterviewStatusRef: UpdatePersonaInterviewStatusRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updatePersonaInterviewStatusRef:
```typescript
const name = updatePersonaInterviewStatusRef.operationName;
console.log(name);
```

### Variables
The `UpdatePersonaInterviewStatus` mutation requires an argument of type `UpdatePersonaInterviewStatusVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdatePersonaInterviewStatusVariables {
  id: UUIDString;
  status: string;
  errorMessage?: string | null;
}
```
### Return Type
Recall that executing the `UpdatePersonaInterviewStatus` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdatePersonaInterviewStatusData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdatePersonaInterviewStatusData {
  personaInterview_update?: PersonaInterview_Key | null;
}
```
### Using `UpdatePersonaInterviewStatus`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updatePersonaInterviewStatus, UpdatePersonaInterviewStatusVariables } from '@dataconnect/generated';

// The `UpdatePersonaInterviewStatus` mutation requires an argument of type `UpdatePersonaInterviewStatusVariables`:
const updatePersonaInterviewStatusVars: UpdatePersonaInterviewStatusVariables = {
  id: ..., 
  status: ..., 
  errorMessage: ..., // optional
};

// Call the `updatePersonaInterviewStatus()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updatePersonaInterviewStatus(updatePersonaInterviewStatusVars);
// Variables can be defined inline as well.
const { data } = await updatePersonaInterviewStatus({ id: ..., status: ..., errorMessage: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updatePersonaInterviewStatus(dataConnect, updatePersonaInterviewStatusVars);

console.log(data.personaInterview_update);

// Or, you can use the `Promise` API.
updatePersonaInterviewStatus(updatePersonaInterviewStatusVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_update);
});
```

### Using `UpdatePersonaInterviewStatus`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updatePersonaInterviewStatusRef, UpdatePersonaInterviewStatusVariables } from '@dataconnect/generated';

// The `UpdatePersonaInterviewStatus` mutation requires an argument of type `UpdatePersonaInterviewStatusVariables`:
const updatePersonaInterviewStatusVars: UpdatePersonaInterviewStatusVariables = {
  id: ..., 
  status: ..., 
  errorMessage: ..., // optional
};

// Call the `updatePersonaInterviewStatusRef()` function to get a reference to the mutation.
const ref = updatePersonaInterviewStatusRef(updatePersonaInterviewStatusVars);
// Variables can be defined inline as well.
const ref = updatePersonaInterviewStatusRef({ id: ..., status: ..., errorMessage: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updatePersonaInterviewStatusRef(dataConnect, updatePersonaInterviewStatusVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaInterview_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_update);
});
```

## CompletePersonaInterview
You can execute the `CompletePersonaInterview` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
completePersonaInterview(vars: CompletePersonaInterviewVariables): MutationPromise<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;

interface CompletePersonaInterviewRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CompletePersonaInterviewVariables): MutationRef<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;
}
export const completePersonaInterviewRef: CompletePersonaInterviewRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
completePersonaInterview(dc: DataConnect, vars: CompletePersonaInterviewVariables): MutationPromise<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;

interface CompletePersonaInterviewRef {
  ...
  (dc: DataConnect, vars: CompletePersonaInterviewVariables): MutationRef<CompletePersonaInterviewData, CompletePersonaInterviewVariables>;
}
export const completePersonaInterviewRef: CompletePersonaInterviewRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the completePersonaInterviewRef:
```typescript
const name = completePersonaInterviewRef.operationName;
console.log(name);
```

### Variables
The `CompletePersonaInterview` mutation requires an argument of type `CompletePersonaInterviewVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CompletePersonaInterviewVariables {
  id: UUIDString;
  interviewRecord: string;
}
```
### Return Type
Recall that executing the `CompletePersonaInterview` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CompletePersonaInterviewData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CompletePersonaInterviewData {
  personaInterview_update?: PersonaInterview_Key | null;
}
```
### Using `CompletePersonaInterview`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, completePersonaInterview, CompletePersonaInterviewVariables } from '@dataconnect/generated';

// The `CompletePersonaInterview` mutation requires an argument of type `CompletePersonaInterviewVariables`:
const completePersonaInterviewVars: CompletePersonaInterviewVariables = {
  id: ..., 
  interviewRecord: ..., 
};

// Call the `completePersonaInterview()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await completePersonaInterview(completePersonaInterviewVars);
// Variables can be defined inline as well.
const { data } = await completePersonaInterview({ id: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await completePersonaInterview(dataConnect, completePersonaInterviewVars);

console.log(data.personaInterview_update);

// Or, you can use the `Promise` API.
completePersonaInterview(completePersonaInterviewVars).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_update);
});
```

### Using `CompletePersonaInterview`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, completePersonaInterviewRef, CompletePersonaInterviewVariables } from '@dataconnect/generated';

// The `CompletePersonaInterview` mutation requires an argument of type `CompletePersonaInterviewVariables`:
const completePersonaInterviewVars: CompletePersonaInterviewVariables = {
  id: ..., 
  interviewRecord: ..., 
};

// Call the `completePersonaInterviewRef()` function to get a reference to the mutation.
const ref = completePersonaInterviewRef(completePersonaInterviewVars);
// Variables can be defined inline as well.
const ref = completePersonaInterviewRef({ id: ..., interviewRecord: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = completePersonaInterviewRef(dataConnect, completePersonaInterviewVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaInterview_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaInterview_update);
});
```

## CreatePersonaBelief
You can execute the `CreatePersonaBelief` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createPersonaBelief(vars: CreatePersonaBeliefVariables): MutationPromise<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;

interface CreatePersonaBeliefRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaBeliefVariables): MutationRef<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;
}
export const createPersonaBeliefRef: CreatePersonaBeliefRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createPersonaBelief(dc: DataConnect, vars: CreatePersonaBeliefVariables): MutationPromise<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;

interface CreatePersonaBeliefRef {
  ...
  (dc: DataConnect, vars: CreatePersonaBeliefVariables): MutationRef<CreatePersonaBeliefData, CreatePersonaBeliefVariables>;
}
export const createPersonaBeliefRef: CreatePersonaBeliefRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createPersonaBeliefRef:
```typescript
const name = createPersonaBeliefRef.operationName;
console.log(name);
```

### Variables
The `CreatePersonaBelief` mutation requires an argument of type `CreatePersonaBeliefVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreatePersonaBeliefVariables {
  personaId: UUIDString;
  version: number;
  content: string;
  changeType?: string | null;
  changeSummary?: string | null;
  triggeredByTurnId?: UUIDString | null;
}
```
### Return Type
Recall that executing the `CreatePersonaBelief` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreatePersonaBeliefData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreatePersonaBeliefData {
  personaBelief_insert: PersonaBelief_Key;
}
```
### Using `CreatePersonaBelief`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createPersonaBelief, CreatePersonaBeliefVariables } from '@dataconnect/generated';

// The `CreatePersonaBelief` mutation requires an argument of type `CreatePersonaBeliefVariables`:
const createPersonaBeliefVars: CreatePersonaBeliefVariables = {
  personaId: ..., 
  version: ..., 
  content: ..., 
  changeType: ..., // optional
  changeSummary: ..., // optional
  triggeredByTurnId: ..., // optional
};

// Call the `createPersonaBelief()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createPersonaBelief(createPersonaBeliefVars);
// Variables can be defined inline as well.
const { data } = await createPersonaBelief({ personaId: ..., version: ..., content: ..., changeType: ..., changeSummary: ..., triggeredByTurnId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createPersonaBelief(dataConnect, createPersonaBeliefVars);

console.log(data.personaBelief_insert);

// Or, you can use the `Promise` API.
createPersonaBelief(createPersonaBeliefVars).then((response) => {
  const data = response.data;
  console.log(data.personaBelief_insert);
});
```

### Using `CreatePersonaBelief`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createPersonaBeliefRef, CreatePersonaBeliefVariables } from '@dataconnect/generated';

// The `CreatePersonaBelief` mutation requires an argument of type `CreatePersonaBeliefVariables`:
const createPersonaBeliefVars: CreatePersonaBeliefVariables = {
  personaId: ..., 
  version: ..., 
  content: ..., 
  changeType: ..., // optional
  changeSummary: ..., // optional
  triggeredByTurnId: ..., // optional
};

// Call the `createPersonaBeliefRef()` function to get a reference to the mutation.
const ref = createPersonaBeliefRef(createPersonaBeliefVars);
// Variables can be defined inline as well.
const ref = createPersonaBeliefRef({ personaId: ..., version: ..., content: ..., changeType: ..., changeSummary: ..., triggeredByTurnId: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createPersonaBeliefRef(dataConnect, createPersonaBeliefVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.personaBelief_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.personaBelief_insert);
});
```

## CreateDebateSession
You can execute the `CreateDebateSession` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createDebateSession(vars: CreateDebateSessionVariables): MutationPromise<CreateDebateSessionData, CreateDebateSessionVariables>;

interface CreateDebateSessionRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateSessionVariables): MutationRef<CreateDebateSessionData, CreateDebateSessionVariables>;
}
export const createDebateSessionRef: CreateDebateSessionRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createDebateSession(dc: DataConnect, vars: CreateDebateSessionVariables): MutationPromise<CreateDebateSessionData, CreateDebateSessionVariables>;

interface CreateDebateSessionRef {
  ...
  (dc: DataConnect, vars: CreateDebateSessionVariables): MutationRef<CreateDebateSessionData, CreateDebateSessionVariables>;
}
export const createDebateSessionRef: CreateDebateSessionRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createDebateSessionRef:
```typescript
const name = createDebateSessionRef.operationName;
console.log(name);
```

### Variables
The `CreateDebateSession` mutation requires an argument of type `CreateDebateSessionVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateDebateSessionVariables {
  topicId: UUIDString;
}
```
### Return Type
Recall that executing the `CreateDebateSession` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateDebateSessionData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateDebateSessionData {
  debateSession_insert: DebateSession_Key;
}
```
### Using `CreateDebateSession`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createDebateSession, CreateDebateSessionVariables } from '@dataconnect/generated';

// The `CreateDebateSession` mutation requires an argument of type `CreateDebateSessionVariables`:
const createDebateSessionVars: CreateDebateSessionVariables = {
  topicId: ..., 
};

// Call the `createDebateSession()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createDebateSession(createDebateSessionVars);
// Variables can be defined inline as well.
const { data } = await createDebateSession({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createDebateSession(dataConnect, createDebateSessionVars);

console.log(data.debateSession_insert);

// Or, you can use the `Promise` API.
createDebateSession(createDebateSessionVars).then((response) => {
  const data = response.data;
  console.log(data.debateSession_insert);
});
```

### Using `CreateDebateSession`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createDebateSessionRef, CreateDebateSessionVariables } from '@dataconnect/generated';

// The `CreateDebateSession` mutation requires an argument of type `CreateDebateSessionVariables`:
const createDebateSessionVars: CreateDebateSessionVariables = {
  topicId: ..., 
};

// Call the `createDebateSessionRef()` function to get a reference to the mutation.
const ref = createDebateSessionRef(createDebateSessionVars);
// Variables can be defined inline as well.
const ref = createDebateSessionRef({ topicId: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createDebateSessionRef(dataConnect, createDebateSessionVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateSession_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSession_insert);
});
```

## UpdateDebateSessionStatus
You can execute the `UpdateDebateSessionStatus` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updateDebateSessionStatus(vars: UpdateDebateSessionStatusVariables): MutationPromise<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;

interface UpdateDebateSessionStatusRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateDebateSessionStatusVariables): MutationRef<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;
}
export const updateDebateSessionStatusRef: UpdateDebateSessionStatusRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateDebateSessionStatus(dc: DataConnect, vars: UpdateDebateSessionStatusVariables): MutationPromise<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;

interface UpdateDebateSessionStatusRef {
  ...
  (dc: DataConnect, vars: UpdateDebateSessionStatusVariables): MutationRef<UpdateDebateSessionStatusData, UpdateDebateSessionStatusVariables>;
}
export const updateDebateSessionStatusRef: UpdateDebateSessionStatusRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateDebateSessionStatusRef:
```typescript
const name = updateDebateSessionStatusRef.operationName;
console.log(name);
```

### Variables
The `UpdateDebateSessionStatus` mutation requires an argument of type `UpdateDebateSessionStatusVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateDebateSessionStatusVariables {
  id: UUIDString;
  status: string;
}
```
### Return Type
Recall that executing the `UpdateDebateSessionStatus` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateDebateSessionStatusData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateDebateSessionStatusData {
  debateSession_update?: DebateSession_Key | null;
}
```
### Using `UpdateDebateSessionStatus`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateDebateSessionStatus, UpdateDebateSessionStatusVariables } from '@dataconnect/generated';

// The `UpdateDebateSessionStatus` mutation requires an argument of type `UpdateDebateSessionStatusVariables`:
const updateDebateSessionStatusVars: UpdateDebateSessionStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateDebateSessionStatus()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateDebateSessionStatus(updateDebateSessionStatusVars);
// Variables can be defined inline as well.
const { data } = await updateDebateSessionStatus({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateDebateSessionStatus(dataConnect, updateDebateSessionStatusVars);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
updateDebateSessionStatus(updateDebateSessionStatusVars).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

### Using `UpdateDebateSessionStatus`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateDebateSessionStatusRef, UpdateDebateSessionStatusVariables } from '@dataconnect/generated';

// The `UpdateDebateSessionStatus` mutation requires an argument of type `UpdateDebateSessionStatusVariables`:
const updateDebateSessionStatusVars: UpdateDebateSessionStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateDebateSessionStatusRef()` function to get a reference to the mutation.
const ref = updateDebateSessionStatusRef(updateDebateSessionStatusVars);
// Variables can be defined inline as well.
const ref = updateDebateSessionStatusRef({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateDebateSessionStatusRef(dataConnect, updateDebateSessionStatusVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

## CompleteDebateSession
You can execute the `CompleteDebateSession` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
completeDebateSession(vars: CompleteDebateSessionVariables): MutationPromise<CompleteDebateSessionData, CompleteDebateSessionVariables>;

interface CompleteDebateSessionRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CompleteDebateSessionVariables): MutationRef<CompleteDebateSessionData, CompleteDebateSessionVariables>;
}
export const completeDebateSessionRef: CompleteDebateSessionRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
completeDebateSession(dc: DataConnect, vars: CompleteDebateSessionVariables): MutationPromise<CompleteDebateSessionData, CompleteDebateSessionVariables>;

interface CompleteDebateSessionRef {
  ...
  (dc: DataConnect, vars: CompleteDebateSessionVariables): MutationRef<CompleteDebateSessionData, CompleteDebateSessionVariables>;
}
export const completeDebateSessionRef: CompleteDebateSessionRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the completeDebateSessionRef:
```typescript
const name = completeDebateSessionRef.operationName;
console.log(name);
```

### Variables
The `CompleteDebateSession` mutation requires an argument of type `CompleteDebateSessionVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CompleteDebateSessionVariables {
  id: UUIDString;
  totalTurns: number;
}
```
### Return Type
Recall that executing the `CompleteDebateSession` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CompleteDebateSessionData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CompleteDebateSessionData {
  debateSession_update?: DebateSession_Key | null;
}
```
### Using `CompleteDebateSession`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, completeDebateSession, CompleteDebateSessionVariables } from '@dataconnect/generated';

// The `CompleteDebateSession` mutation requires an argument of type `CompleteDebateSessionVariables`:
const completeDebateSessionVars: CompleteDebateSessionVariables = {
  id: ..., 
  totalTurns: ..., 
};

// Call the `completeDebateSession()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await completeDebateSession(completeDebateSessionVars);
// Variables can be defined inline as well.
const { data } = await completeDebateSession({ id: ..., totalTurns: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await completeDebateSession(dataConnect, completeDebateSessionVars);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
completeDebateSession(completeDebateSessionVars).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

### Using `CompleteDebateSession`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, completeDebateSessionRef, CompleteDebateSessionVariables } from '@dataconnect/generated';

// The `CompleteDebateSession` mutation requires an argument of type `CompleteDebateSessionVariables`:
const completeDebateSessionVars: CompleteDebateSessionVariables = {
  id: ..., 
  totalTurns: ..., 
};

// Call the `completeDebateSessionRef()` function to get a reference to the mutation.
const ref = completeDebateSessionRef(completeDebateSessionVars);
// Variables can be defined inline as well.
const ref = completeDebateSessionRef({ id: ..., totalTurns: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = completeDebateSessionRef(dataConnect, completeDebateSessionVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

## PublishDebateSession
You can execute the `PublishDebateSession` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
publishDebateSession(vars: PublishDebateSessionVariables): MutationPromise<PublishDebateSessionData, PublishDebateSessionVariables>;

interface PublishDebateSessionRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: PublishDebateSessionVariables): MutationRef<PublishDebateSessionData, PublishDebateSessionVariables>;
}
export const publishDebateSessionRef: PublishDebateSessionRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
publishDebateSession(dc: DataConnect, vars: PublishDebateSessionVariables): MutationPromise<PublishDebateSessionData, PublishDebateSessionVariables>;

interface PublishDebateSessionRef {
  ...
  (dc: DataConnect, vars: PublishDebateSessionVariables): MutationRef<PublishDebateSessionData, PublishDebateSessionVariables>;
}
export const publishDebateSessionRef: PublishDebateSessionRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the publishDebateSessionRef:
```typescript
const name = publishDebateSessionRef.operationName;
console.log(name);
```

### Variables
The `PublishDebateSession` mutation requires an argument of type `PublishDebateSessionVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface PublishDebateSessionVariables {
  id: UUIDString;
}
```
### Return Type
Recall that executing the `PublishDebateSession` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `PublishDebateSessionData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface PublishDebateSessionData {
  debateSession_update?: DebateSession_Key | null;
}
```
### Using `PublishDebateSession`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, publishDebateSession, PublishDebateSessionVariables } from '@dataconnect/generated';

// The `PublishDebateSession` mutation requires an argument of type `PublishDebateSessionVariables`:
const publishDebateSessionVars: PublishDebateSessionVariables = {
  id: ..., 
};

// Call the `publishDebateSession()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await publishDebateSession(publishDebateSessionVars);
// Variables can be defined inline as well.
const { data } = await publishDebateSession({ id: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await publishDebateSession(dataConnect, publishDebateSessionVars);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
publishDebateSession(publishDebateSessionVars).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

### Using `PublishDebateSession`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, publishDebateSessionRef, PublishDebateSessionVariables } from '@dataconnect/generated';

// The `PublishDebateSession` mutation requires an argument of type `PublishDebateSessionVariables`:
const publishDebateSessionVars: PublishDebateSessionVariables = {
  id: ..., 
};

// Call the `publishDebateSessionRef()` function to get a reference to the mutation.
const ref = publishDebateSessionRef(publishDebateSessionVars);
// Variables can be defined inline as well.
const ref = publishDebateSessionRef({ id: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = publishDebateSessionRef(dataConnect, publishDebateSessionVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateSession_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateSession_update);
});
```

## CreateDebateTurn
You can execute the `CreateDebateTurn` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createDebateTurn(vars: CreateDebateTurnVariables): MutationPromise<CreateDebateTurnData, CreateDebateTurnVariables>;

interface CreateDebateTurnRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDebateTurnVariables): MutationRef<CreateDebateTurnData, CreateDebateTurnVariables>;
}
export const createDebateTurnRef: CreateDebateTurnRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createDebateTurn(dc: DataConnect, vars: CreateDebateTurnVariables): MutationPromise<CreateDebateTurnData, CreateDebateTurnVariables>;

interface CreateDebateTurnRef {
  ...
  (dc: DataConnect, vars: CreateDebateTurnVariables): MutationRef<CreateDebateTurnData, CreateDebateTurnVariables>;
}
export const createDebateTurnRef: CreateDebateTurnRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createDebateTurnRef:
```typescript
const name = createDebateTurnRef.operationName;
console.log(name);
```

### Variables
The `CreateDebateTurn` mutation requires an argument of type `CreateDebateTurnVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateDebateTurnVariables {
  sessionId: UUIDString;
  turnIndex: number;
  speakerType: string;
  personaId?: UUIDString | null;
  content: string;
}
```
### Return Type
Recall that executing the `CreateDebateTurn` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateDebateTurnData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateDebateTurnData {
  debateTurn_insert: DebateTurn_Key;
}
```
### Using `CreateDebateTurn`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createDebateTurn, CreateDebateTurnVariables } from '@dataconnect/generated';

// The `CreateDebateTurn` mutation requires an argument of type `CreateDebateTurnVariables`:
const createDebateTurnVars: CreateDebateTurnVariables = {
  sessionId: ..., 
  turnIndex: ..., 
  speakerType: ..., 
  personaId: ..., // optional
  content: ..., 
};

// Call the `createDebateTurn()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createDebateTurn(createDebateTurnVars);
// Variables can be defined inline as well.
const { data } = await createDebateTurn({ sessionId: ..., turnIndex: ..., speakerType: ..., personaId: ..., content: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createDebateTurn(dataConnect, createDebateTurnVars);

console.log(data.debateTurn_insert);

// Or, you can use the `Promise` API.
createDebateTurn(createDebateTurnVars).then((response) => {
  const data = response.data;
  console.log(data.debateTurn_insert);
});
```

### Using `CreateDebateTurn`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createDebateTurnRef, CreateDebateTurnVariables } from '@dataconnect/generated';

// The `CreateDebateTurn` mutation requires an argument of type `CreateDebateTurnVariables`:
const createDebateTurnVars: CreateDebateTurnVariables = {
  sessionId: ..., 
  turnIndex: ..., 
  speakerType: ..., 
  personaId: ..., // optional
  content: ..., 
};

// Call the `createDebateTurnRef()` function to get a reference to the mutation.
const ref = createDebateTurnRef(createDebateTurnVars);
// Variables can be defined inline as well.
const ref = createDebateTurnRef({ sessionId: ..., turnIndex: ..., speakerType: ..., personaId: ..., content: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createDebateTurnRef(dataConnect, createDebateTurnVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.debateTurn_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.debateTurn_insert);
});
```

## CreatePostDebateComment
You can execute the `CreatePostDebateComment` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createPostDebateComment(vars: CreatePostDebateCommentVariables): MutationPromise<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;

interface CreatePostDebateCommentRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePostDebateCommentVariables): MutationRef<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;
}
export const createPostDebateCommentRef: CreatePostDebateCommentRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createPostDebateComment(dc: DataConnect, vars: CreatePostDebateCommentVariables): MutationPromise<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;

interface CreatePostDebateCommentRef {
  ...
  (dc: DataConnect, vars: CreatePostDebateCommentVariables): MutationRef<CreatePostDebateCommentData, CreatePostDebateCommentVariables>;
}
export const createPostDebateCommentRef: CreatePostDebateCommentRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createPostDebateCommentRef:
```typescript
const name = createPostDebateCommentRef.operationName;
console.log(name);
```

### Variables
The `CreatePostDebateComment` mutation requires an argument of type `CreatePostDebateCommentVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreatePostDebateCommentVariables {
  sessionId: UUIDString;
  personaId: UUIDString;
  content: string;
  sortOrder: number;
}
```
### Return Type
Recall that executing the `CreatePostDebateComment` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreatePostDebateCommentData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreatePostDebateCommentData {
  postDebateComment_insert: PostDebateComment_Key;
}
```
### Using `CreatePostDebateComment`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createPostDebateComment, CreatePostDebateCommentVariables } from '@dataconnect/generated';

// The `CreatePostDebateComment` mutation requires an argument of type `CreatePostDebateCommentVariables`:
const createPostDebateCommentVars: CreatePostDebateCommentVariables = {
  sessionId: ..., 
  personaId: ..., 
  content: ..., 
  sortOrder: ..., 
};

// Call the `createPostDebateComment()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createPostDebateComment(createPostDebateCommentVars);
// Variables can be defined inline as well.
const { data } = await createPostDebateComment({ sessionId: ..., personaId: ..., content: ..., sortOrder: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createPostDebateComment(dataConnect, createPostDebateCommentVars);

console.log(data.postDebateComment_insert);

// Or, you can use the `Promise` API.
createPostDebateComment(createPostDebateCommentVars).then((response) => {
  const data = response.data;
  console.log(data.postDebateComment_insert);
});
```

### Using `CreatePostDebateComment`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createPostDebateCommentRef, CreatePostDebateCommentVariables } from '@dataconnect/generated';

// The `CreatePostDebateComment` mutation requires an argument of type `CreatePostDebateCommentVariables`:
const createPostDebateCommentVars: CreatePostDebateCommentVariables = {
  sessionId: ..., 
  personaId: ..., 
  content: ..., 
  sortOrder: ..., 
};

// Call the `createPostDebateCommentRef()` function to get a reference to the mutation.
const ref = createPostDebateCommentRef(createPostDebateCommentVars);
// Variables can be defined inline as well.
const ref = createPostDebateCommentRef({ sessionId: ..., personaId: ..., content: ..., sortOrder: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createPostDebateCommentRef(dataConnect, createPostDebateCommentVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.postDebateComment_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.postDebateComment_insert);
});
```

