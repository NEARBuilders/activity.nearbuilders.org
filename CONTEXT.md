# Activity Service

The Activity Service registers event-producing Activity Sources and turns their signed events into
portable activity and reputation data.

## Language

**Activity Source**:
A stable event-producing identity owned by one NEAR-authenticated organization and associated with
the source's NEAR account.
_Avoid_: Project, tenant, application

**Source Owner**:
An organization member with the owner role who can configure that organization's Activity Sources.
_Avoid_: Project admin, tenant owner

**Event Type**:
A source-scoped category of Activity event with a unique name, description, enabled state, and point
value.
_Avoid_: Event name, action

**Approval Status**:
The lifecycle state `pending`, `approved`, or `rejected` that determines whether an Activity Source
may submit events.
_Avoid_: Source status, trust status

**Trust Designation**:
The administrator-controlled state `standard` or `trusted` that changes score weighting but never
changes whether a source may submit events.
_Avoid_: Approval status, verified source

**Score Multiplier**:
The current source-level multiplier applied to raw event counts at leaderboard read time. A change
also affects historical periods without replaying events.
_Avoid_: Stored score, approval weight

**Platform Administrator**:
A service-level administrator who reviews Activity Sources independently of organization membership.
_Avoid_: Source admin, organization admin

**Signing Identity**:
The cryptographic identity of one Activity Source whose public identity remains meaningful after it
is rotated.
_Avoid_: User key, organization key

**Cryptographic Provenance**:
Proof that an event's signature matches the registered Signing Identity active when it was signed.
It attributes the event to the source but does not independently verify claims inside its payload.
_Avoid_: Trusted event, verified payload

**Source API Key**:
A revocable credential belonging to exactly one Activity Source and authorizing that source to
submit Activity events.
_Avoid_: User API key, organization API key

**Binding Proof**:
Evidence that an Activity Source's NEAR account authorized its association with a Signing Identity.
_Avoid_: Login proof, source approval
