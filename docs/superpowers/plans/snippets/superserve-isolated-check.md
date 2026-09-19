# SuperServe Boundary Check: Isolated Jobs Only

Checklist to verify the architectural boundary between **Spark Workspace Runtime** and **SuperServe MicroVMs**:

- [x] **Primary AIUI Workspace Ownership**: The Spark sandbox-runner (`:17330`) strictly owns and allocates all development workspaces under `/tmp/spark-sandboxes/workspaceN`.
- [x] **SuperServe Control Path Isolation**: SuperServe operates out-of-band under `~/superserve-linux` and `~/superserve-agent`. AIUI code is never cloned or stored directly inside SuperServe directories.
- [x] **Runtime Isolation**: Launching a SuperServe job/MicroVM does not terminate `:17330` or change the current working directory of any active `workspaceN` on Spark.
- [x] **No Port Contention**: Spark sandbox-runner listens on `17330`, vLLM on `8000`, Compute on `8090`; SuperServe microVMs allocate dynamic out-of-band bridge interfaces without conflict.
