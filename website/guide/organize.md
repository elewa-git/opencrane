# Organise your company

OpenCrane represents your organisation with **groups**. A group can sit below another group, so
the same model covers company-wide, department, team and project structures without fixed
categories.

::: tip Two boundary kinds
OpenCrane authorises resources against either a stored group or one person's personal boundary.
Names such as “Engineering”, “Platform team” and “Website redesign” are group data, not special
IAM types.
:::

## Build a group hierarchy

Give a group a parent when it belongs inside a larger part of the organisation:

```text
Acme
├── Product
│   ├── Platform
│   └── Website redesign
└── Finance
```

The hierarchy describes resource reach. A grant on `Product` with descendant coverage can include
`Platform` and `Website redesign`; an exact grant covers only `Product`.

Membership remains direct. Adding someone to `Platform` does not silently create a second
membership row for `Product` or `Acme`.

## Choose who manages membership

Each group has one membership authority:

| Authority | Who changes direct membership |
|---|---|
| External | Login-claim reconciliation from your identity provider |
| Local | An OpenCrane operator through `/api/v1/groups` |

Login claims refer to groups as `group:<stable-group-id>`. Reconciliation updates only external
groups, so it cannot prune membership that an operator curated in a local group.

::: warning
Changing a group's parent does not change who belongs to that group. Review descendant grants
separately because hierarchy changes can change which resource boundaries they cover.
:::

## Personal boundaries

A personal boundary belongs to one principal and is not a hidden group. Use it for private
assistant memory, personal resources and exact person-to-person sharing.

## A simple way to start

1. Create a company group.
2. Add the department, team and project groups you need beneath it.
3. Choose external or local membership authority for each group.
4. Grant access at the narrowest group or personal boundary that fits, using descendant coverage
   only when the hierarchy should inherit the resource reach.

→ [Control who can access what](/guide/permissions) · [Silo IAM](/integrators/silo-iam)
