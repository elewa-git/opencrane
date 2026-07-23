---
layout: home

hero:
  text: AI that helps people get work done.
  tagline: >-
    Give your team a private place to work with AI, the right company information,
    and the tools they already use — while keeping it all in your hands.
  image:
    src: /opencrane-logo.png
    alt: OpenCrane — self-hosted organizational AI control plane
  actions:
    - theme: brand
      text: See what your team can do
      link: /guide/first-tenant
    - theme: alt
      text: Get OpenCrane ready
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/elewa-git/opencrane

features:
  - title: Give people a helpful AI teammate
    details: >-
      Give everyone a private workspace, then add the information and support
      that make sense for the work they do.
    link: /guide/first-tenant
    linkText: Meet the workspace
  - title: Turn good work into shared playbooks
    details: >-
      Capture a useful way of working once and share it with the people who can
      benefit from it.
    link: /guide/skills
    linkText: Share a playbook
  - title: Bring everyday tools into the conversation
    details: >-
      Help people move work forward with the tools they already rely on, from
      team chat to project tracking and customer systems.
    link: /guide/tools
    linkText: Bring in a tool
  - title: Help AI use the right information
    details: >-
      Bring company information together so people can get answers grounded in
      real sources instead of starting from a blank page.
    link: /guide/knowledge
    linkText: Add company knowledge
  - title: Keep an eye on AI usage
    details: >-
      Set sensible limits and see how AI is being used across your organisation.
    link: /guide/budgets
    linkText: View usage
---

<script setup>
import { withBase } from 'vitepress'
</script>

<div class="oc-home">

<section class="oc-home-problem" aria-labelledby="problem-heading">
  <div>
    <p class="oc-eyebrow">The problem</p>
    <h2 id="problem-heading">Good work should not get lost in chats, documents, and people’s heads.</h2>
  </div>
  <p>AI is most helpful when it understands the work around it. OpenCrane brings together the knowledge, tools, and proven ways of working your people need, without turning every conversation into a free-for-all.</p>
</section>

<section class="oc-home-showcase" aria-labelledby="workspace-heading">
  <div class="oc-home-copy">
    <p class="oc-eyebrow">Start with people</p>
    <h2 id="workspace-heading">A private AI teammate for every person</h2>
    <p>Each person starts with a workspace of their own. You can give it the information, practical help, and connected tools that make a real difference in their day — not just another blank chat window.</p>
    <a class="oc-text-link" :href="withBase('/guide/first-tenant')">See the personal workspace <span aria-hidden="true">→</span></a>
  </div>
  <figure class="oc-product-shot oc-product-shot--welcome">
    <img :src="withBase('/product/assistant-workspace.jpeg')" alt="An OpenCrane employee assistant workspace welcoming a new user" width="1999" height="1271" loading="lazy" />
    <figcaption>A personal workspace, with helpful company context when it is needed.</figcaption>
  </figure>
</section>

<section class="oc-home-workflow" aria-labelledby="workflow-heading">
  <div class="oc-home-workflow-intro">
    <p class="oc-eyebrow">Make work repeatable</p>
    <h2 id="workflow-heading">Turn the good ways of working into skills your team can use.</h2>
    <p>Capture a useful way of working once, then share it with the people who need it. A shared playbook can help a project team follow a process, give a department a reliable starting point, or support the whole organisation.</p>
    <a class="oc-text-link" :href="withBase('/guide/skills')">Explore shared playbooks <span aria-hidden="true">→</span></a>
  </div>
  <div class="oc-home-workflow-visuals">
    <figure class="oc-product-shot oc-product-shot--skills">
      <img :src="withBase('/product/skills-catalogue.jpeg')" alt="An OpenCrane skills catalogue showing reusable team capabilities" width="1999" height="1278" loading="lazy" />
    </figure>
    <figure class="oc-product-shot oc-product-shot--workflow">
      <img :src="withBase('/product/agent-workflow.jpeg')" alt="An OpenCrane workflow that reviews incoming project information after connected tools update" width="1999" height="1264" loading="lazy" />
    </figure>
  </div>
</section>

<section class="oc-home-governance" aria-labelledby="governance-heading">
  <div class="oc-home-governance-card">
    <p class="oc-eyebrow">Useful, with clear boundaries</p>
    <h2 id="governance-heading">Keep the helpful parts in sight.</h2>
    <p>Choose how widely useful playbooks, tools, and information are shared. Set sensible limits, see how AI is being used, and keep each person’s workspace private by default.</p>
    <div class="oc-home-actions">
      <a class="VPButton brand medium" :href="withBase('/guide/permissions')">Choose who uses what</a>
      <a class="VPButton alt medium" :href="withBase('/guide/budgets')">Keep an eye on usage</a>
    </div>
  </div>
  <figure class="oc-product-shot oc-product-shot--budget">
    <img :src="withBase('/product/budget-controls.jpeg')" alt="An OpenCrane budget dashboard showing organisation and member usage controls" width="1999" height="1270" loading="lazy" />
  </figure>
</section>

<section class="oc-home-next" aria-labelledby="next-heading">
  <p class="oc-eyebrow">Choose your next step</p>
  <h2 id="next-heading">Start small. Make one part of work better.</h2>
  <div class="oc-home-next-grid">
    <a :href="withBase('/guide/getting-started')"><strong>Get OpenCrane ready</strong><span>Set up a private home for your organisation’s AI.</span><b aria-hidden="true">→</b></a>
    <a :href="withBase('/guide/knowledge')"><strong>Connect company knowledge</strong><span>Give assistants better context from real sources.</span><b aria-hidden="true">→</b></a>
    <a :href="withBase('/guide/tools')"><strong>Bring in a work tool</strong><span>Let AI help where the work already happens.</span><b aria-hidden="true">→</b></a>
  </div>
</section>

</div>
