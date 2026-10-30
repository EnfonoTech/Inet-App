import { useState } from "react";
import SearchableSelect from "./SearchableSelect";
import useFilterOptions from "../hooks/useFilterOptions";

/**
 * The three line attributes most pages filter by once a line is planned:
 * Subcontractor, Contract Model and Domain. One hook holds the state and the
 * option lists, one component draws the dropdowns, so every page offers the
 * same choices under the same names.
 *
 * Backend contract — the portal filter keys a list endpoint must honour, each
 * blank-aware (FILTER_BLANK via _sql_in_or_eq) and matched on what the cell
 * RENDERS:
 *   subcontractor   Subcontract Master name
 *   contract_model  Subcontract Master.contract_model
 *   domain          the line's project_domain, else its project's
 *
 * `withSubcontractor: false` / `withDomain: false` are for pages that already
 * have their own dropdown for that attribute.
 *
 *   const attr = useLineAttributeFilters();
 *   attr.apply(portal);                   // in the fetch
 *   [..., attr.key]                       // in the fetch's deps
 *   <LineAttributeFilters attr={attr} />  // in the toolbar
 */
export function useLineAttributeFilters({ withSubcontractor = true, withDomain = true } = {}) {
  const [subcontractor, setSubcontractor] = useState([]);
  const [contractModel, setContractModel] = useState([]);
  const [domain, setDomain] = useState([]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", withSubcontractor ? ["contract"] : []);
  const { options: smOpts } = useFilterOptions("Subcontract Master", ["contract_model"]);
  const { options: domOpts } = useFilterOptions("Project Domain", withDomain ? ["name"] : []);
  const toOpts = (vals) => (vals || []).filter(Boolean).map((v) => ({ id: v, label: v }));

  const subs = withSubcontractor ? subcontractor : [];
  const doms = withDomain ? domain : [];
  return {
    withSubcontractor,
    withDomain,
    subcontractor, setSubcontractor,
    contractModel, setContractModel,
    domain, setDomain,
    options: {
      subcontractor: toOpts(dispOpts.contract),
      contractModel: toOpts(smOpts.contract_model),
      domain: toOpts(domOpts.name),
    },
    key: JSON.stringify([subs, contractModel, doms]),
    active: !!(subs.length || contractModel.length || doms.length),
    apply(portal) {
      if (subs.length) portal.subcontractor = subs;
      if (contractModel.length) portal.contract_model = contractModel;
      if (doms.length) portal.domain = doms;
      return portal;
    },
    reset() {
      setSubcontractor([]);
      setContractModel([]);
      setDomain([]);
    },
  };
}

export default function LineAttributeFilters({ attr }) {
  return (
    <>
      {attr.withSubcontractor && (
        <SearchableSelect allowBlank multi value={attr.subcontractor} onChange={attr.setSubcontractor}
                          options={attr.options.subcontractor} placeholder="All Subcontractors" minWidth={170} />
      )}
      <SearchableSelect allowBlank multi value={attr.contractModel} onChange={attr.setContractModel}
                        options={attr.options.contractModel} placeholder="All Contract Models" minWidth={170} />
      {attr.withDomain && (
        <SearchableSelect allowBlank multi value={attr.domain} onChange={attr.setDomain}
                          options={attr.options.domain} placeholder="All Domains" minWidth={150} />
      )}
    </>
  );
}
