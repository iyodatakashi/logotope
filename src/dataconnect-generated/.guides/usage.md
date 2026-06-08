# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { getTopics, getTopicById, getStakeholderMapByTopicId, getPersonasByTopicId, getApprovedPersonasByTopicId, getPersonaInterviewByPersonaId, getPersonaBeliefsByPersonaId, getPersonaBeliefHistoryByTopicId, getDebateSessionByTopicId, getDebateTurnsBySessionId } from '@dataconnect/generated';


// Operation GetTopics: 
const { data } = await GetTopics(dataConnect);

// Operation GetTopicById:  For variables, look at type GetTopicByIdVars in ../index.d.ts
const { data } = await GetTopicById(dataConnect, getTopicByIdVars);

// Operation GetStakeholderMapByTopicId:  For variables, look at type GetStakeholderMapByTopicIdVars in ../index.d.ts
const { data } = await GetStakeholderMapByTopicId(dataConnect, getStakeholderMapByTopicIdVars);

// Operation GetPersonasByTopicId:  For variables, look at type GetPersonasByTopicIdVars in ../index.d.ts
const { data } = await GetPersonasByTopicId(dataConnect, getPersonasByTopicIdVars);

// Operation GetApprovedPersonasByTopicId:  For variables, look at type GetApprovedPersonasByTopicIdVars in ../index.d.ts
const { data } = await GetApprovedPersonasByTopicId(dataConnect, getApprovedPersonasByTopicIdVars);

// Operation GetPersonaInterviewByPersonaId:  For variables, look at type GetPersonaInterviewByPersonaIdVars in ../index.d.ts
const { data } = await GetPersonaInterviewByPersonaId(dataConnect, getPersonaInterviewByPersonaIdVars);

// Operation GetPersonaBeliefsByPersonaId:  For variables, look at type GetPersonaBeliefsByPersonaIdVars in ../index.d.ts
const { data } = await GetPersonaBeliefsByPersonaId(dataConnect, getPersonaBeliefsByPersonaIdVars);

// Operation GetPersonaBeliefHistoryByTopicId:  For variables, look at type GetPersonaBeliefHistoryByTopicIdVars in ../index.d.ts
const { data } = await GetPersonaBeliefHistoryByTopicId(dataConnect, getPersonaBeliefHistoryByTopicIdVars);

// Operation GetDebateSessionByTopicId:  For variables, look at type GetDebateSessionByTopicIdVars in ../index.d.ts
const { data } = await GetDebateSessionByTopicId(dataConnect, getDebateSessionByTopicIdVars);

// Operation GetDebateTurnsBySessionId:  For variables, look at type GetDebateTurnsBySessionIdVars in ../index.d.ts
const { data } = await GetDebateTurnsBySessionId(dataConnect, getDebateTurnsBySessionIdVars);


```