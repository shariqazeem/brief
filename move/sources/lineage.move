/// Lineage — read-only graph traversal over WorkObjects.
///
/// Sui Move discourages on-chain recursion and unbounded loops because of
/// gas. The practical pattern is: clients walk the parent graph off-chain
/// by repeatedly fetching parent objects from RPC, then optionally submit
/// a flattened ProvenanceManifest back on-chain for "high-assurance"
/// verification of a small graph.
module brief::lineage {
    use sui::object::ID;

    use brief::work_object::{Self, WorkObject};

    // ----------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------

    /// A flattened lineage manifest. Built by the client by walking
    /// parents off-chain, then optionally submitted back on-chain for
    /// archival or proof.
    public struct ProvenanceManifest has copy, drop, store {
        root_id: ID,
        ancestor_ids: vector<ID>,
        depth: u64,
    }

    // ----------------------------------------------------------------------
    // Accessors
    // ----------------------------------------------------------------------

    /// Returns a copy of the direct (1-hop) parents of a WorkObject.
    /// Off-chain code recursively calls this on each parent to materialize
    /// the full graph.
    public fun direct_parents(obj: &WorkObject): vector<ID> {
        *work_object::parents(obj)
    }

    /// Build a manifest from a client-supplied flat ancestor list.
    /// Use case: archive a completed Brief by snapshotting the lineage.
    public fun build_manifest(
        root: &WorkObject,
        ancestor_ids: vector<ID>,
        depth: u64,
    ): ProvenanceManifest {
        ProvenanceManifest {
            root_id: sui::object::id(root),
            ancestor_ids,
            depth,
        }
    }

    public fun manifest_root(m: &ProvenanceManifest): ID {
        m.root_id
    }

    public fun manifest_depth(m: &ProvenanceManifest): u64 {
        m.depth
    }

    public fun manifest_ancestors(m: &ProvenanceManifest): &vector<ID> {
        &m.ancestor_ids
    }
}
