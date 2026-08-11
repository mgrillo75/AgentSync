## **Recommendation**

Use **Mem0** as the starting memory framework.

I would deploy it as a separate Python service rather than adding Python directly to AgentSync’s existing Node web dyno:

AgentSync / WAO  
      │ HTTPS  
      ▼  
Mem0 service  
      ├── Heroku Postgres \+ pgvector  
      ├── Managed Neo4j, if graph memory is enabled  
      └── Existing LLM/embedding provider

Heroku officially supports `pgvector`, so the principal vector store can remain within Heroku Postgres. [Heroku pgvector documentation](https://devcenter.heroku.com/articles/pgvector-heroku-postgres)

## **Repositories that cannot run correctly on Heroku as supplied**

An absolute “can never run” classification would be misleading—almost anything can be substantially redesigned. These repositories, however, cannot provide their intended functionality on Heroku in their supplied architecture.

### **Hard incompatibilities**

* **Rowboat**  
  * It is an Electron desktop application.  
  * It depends on local OS capabilities, browser surfaces, microphone/audio capture, and a local Markdown vault.  
  * Its intended application cannot operate inside a headless Heroku dyno.  
  * Individual backend packages could be extracted, but that would be a different deployment architecture.  
  * Evidence: \[Rowboat snapshot (line 1740)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/mgrillo75-rowboat-8a5edab282632443.txt:1740)  
* **OptMem**  
  * It is a local command-line script rather than a network memory service.  
  * Its complete database is an append-only filesystem directory under `~/.optmem`.  
  * Heroku would erase that memory during deployments, restarts, or dyno replacement.  
  * Turning it into a Heroku service would require creating an API and replacing its storage layer.  
  * Evidence: \[OptMem snapshot (line 15)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/mgrillo75-optmem-8a5edab282632443.txt:15)

### **Cannot run correctly as currently packaged**

* **MemPalace**  
  * Its default ChromaDB/SQLite configuration and embedding cache require a persistent `/data` volume.  
  * Heroku does not provide persistent mounted volumes.  
  * Although MemPalace supports pgvector, other palace and knowledge-graph data remains strongly oriented around local storage. It needs storage adaptation before it is suitable.  
  * Evidence: \[MemPalace snapshot (line 643)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/mgrillo75-mempalace-8a5edab282632443.txt:643)  
* **Memoria**  
  * Its self-hosted stack expects the API and MatrixOne database to run through Docker Compose.  
  * It could place the API on Heroku only if MatrixOne were hosted externally and its deployment configuration were rewritten.  
  * Evidence: \[Memoria snapshot (line 480)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/mgrillo75-memoria-8a5edab282632443.txt:480)  
* **TencentDB Agent Memory**  
  * The supplied deployment starts three interconnected services: Memory Core, Memory Hub, and proxy.  
  * It also includes local SQLite, Redis, Tencent vector database, and object-storage assumptions.  
  * Heroku cannot deploy that Compose topology as one application. It would need to be split into separate services with managed Redis and external databases/storage.  
  * Evidence: \[TencentDB Agent Memory snapshot (line 1275)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/tencentcloud-tencentdb-agent-memory-8a5edab282632443.txt:1275)

Heroku permits individual Docker images, but dynos cannot be network-linked like Docker Compose containers, mounted volumes are unsupported, and the filesystem is ephemeral. [Heroku Container Runtime documentation](https://devcenter.heroku.com/articles/container-registry-and-runtime)

## **Complete repository assessment**

| Repository | Heroku assessment | Principal requirement |
| ----- | ----- | ----- |
| **Cognee** | Conditional | Replace default SQLite, LanceDB, Kuzu, and local files with Postgres/pgvector, external graph storage, and S3 |
| **Deep Lake** | Conditional | Use S3, Activeloop Cloud, or another durable object store; local datasets will disappear |
| **Graphiti** | Compatible with external services | Run FastAPI on Heroku and use managed Neo4j, FalkorDB, or Neptune |
| **Mem0** | **Best fit; compatible with adaptation** | Run its Python API separately with Postgres/pgvector and optional managed Neo4j |
| **Memoria** | Not as supplied | Requires remote MatrixOne and deployment restructuring |
| **MemOS** | Compatible with external services | Run API on Heroku; host Neo4j and Qdrant elsewhere |
| **MemPalace** | Not as supplied | Requires replacement of persistent local volume and embedded stores |
| **OptMem** | Not suitable | Local CLI and filesystem database; no web-service architecture |
| **Rowboat** | Not suitable | Desktop Electron application with local OS dependencies |
| **Octopoda** | Technically compatible, higher risk | Postgres/pgvector configuration fits Heroku, but server licensing and repository maturity are concerns |
| **TencentDB Agent Memory** | Not as supplied | Requires substantial multi-service and storage restructuring |

Heroku dyno files are temporary and isolated; anything stored locally is discarded on restart or replacement. [Heroku dyno isolation documentation](https://devcenter.heroku.com/articles/dyno-isolation)

## **Why Mem0 is my recommendation**

Mem0 provides the best balance of functionality, integration cost, and deployment risk:

* It is focused specifically on application memory rather than being a complete desktop agent environment.  
* It already models user, session, and agent memory, which maps naturally to `waoId`, user IDs, Hermes agents, and conversations.  
* It offers an HTTP server and cross-platform SDKs, making it straightforward for the Node-based AgentSync application to call.  
* It supports both managed and self-hosted paths.  
* It is Apache-licensed.  
* Its storage layer is configurable and supports pgvector.  
* It has a clearer production adoption path than the newer Octopoda repository.  
* It is less operationally expansive than MemOS, TencentDB Agent Memory, or Memoria.

The flattened Mem0 snapshot confirms a FastAPI server and a self-hosted PostgreSQL/pgvector configuration. \[Mem0 snapshot (line 1852)\](/C:/Users/Papa/Documents/AgentSync/memory-frameworks/mgrillo75-mem0-8a5edab282632443.txt:1852)

### **Suggested first iteration**

Start narrowly:

1. Deploy Mem0 as a separate Heroku application.  
2. Use a separate Heroku Postgres database with `pgvector`.  
3. Integrate AgentSync through authenticated server-to-server HTTP.  
4. Namespace every memory using at least:  
   * `waoId`  
   * `userId`  
   * `agentId`  
   * `channelId`  
5. Initially save only explicit user preferences, decisions, and durable facts.  
6. Add graph memory or Neo4j only after ordinary vector memory is operating reliably.

This avoids coupling memory processing to the relay’s real-time WebSocket workload and gives WAO Instances a clean tenant-isolation boundary.

2:21 AM  
