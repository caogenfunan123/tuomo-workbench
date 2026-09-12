import { assertDomain } from './errors.ts';
import { SafeRelativePath, siteId } from './values.ts';
import type { SecretRef, SiteId } from './values.ts';

export type StaticFramework = 'hexo' | 'hugo' | 'jekyll' | 'vuepress' | 'gatsby' | 'nextjs' | 'astro' | 'pelican' | '11ty';
export type SiteKind = 'static' | 'cms';
export type CmsKind = 'wordpress' | 'ghost' | 'typecho-secure' | 'typecho-fastapi' | 'typecho-restful';

export type StaticSiteConfig = {
  provider: 'github' | 'gitlab' | 'gitee' | 'bitbucket' | 'generic';
  repository: string;
  branch: string;
  postPath: SafeRelativePath;
  pagePath: SafeRelativePath;
  framework: StaticFramework;
  filenameRule?: 'slug' | 'date-slug';
  publishTimeZoneOffsetMinutes: number;
  defaultTemplateId?: string;
  credentialRef?: SecretRef;
  mirrors: string[];
  hooks: string[];
  url?: string;
  apiBaseUrl?: string;
  commitMessage?: string;
};

export type CmsSiteConfig = {
  cmsKind: CmsKind;
  baseUrl: string;
  authRef?: SecretRef;
  ignoreSsl: boolean;
  adapterOptions: Record<string, unknown>;
};

export type StaticSite = { id: SiteId; kind: 'static'; name: string; isDefault: boolean; url?: string; config: StaticSiteConfig };
export type CmsSite = { id: SiteId; kind: 'cms'; name: string; isDefault: boolean; url?: string; config: CmsSiteConfig };
export type Site = StaticSite | CmsSite;

export function validateSite(site: Site): void {
  assertDomain(site.name.trim().length > 0, 'Site name cannot be empty');
  if (site.kind === 'static') {
    assertDomain(['github', 'gitlab', 'gitee', 'bitbucket', 'generic'].includes(site.config.provider), 'Static provider is invalid');
    assertDomain(site.config.branch.trim().length > 0, 'Static branch cannot be empty');
    assertDomain(SafeRelativePath.parse(site.config.postPath.value).value === site.config.postPath.value, 'Static post path is invalid');
    assertDomain(SafeRelativePath.parse(site.config.pagePath.value).value === site.config.pagePath.value, 'Static page path is invalid');
    assertDomain(['hexo', 'hugo', 'jekyll', 'vuepress', 'gatsby', 'nextjs', 'astro', 'pelican', '11ty'].includes(site.config.framework), 'Static framework is invalid');
    assertDomain(Number.isInteger(site.config.publishTimeZoneOffsetMinutes) && site.config.publishTimeZoneOffsetMinutes >= -840 && site.config.publishTimeZoneOffsetMinutes <= 840, 'Static timezone offset is invalid');
  } else {
    assertDomain(/^https:\/\//i.test(site.config.baseUrl) || site.config.ignoreSsl, 'CMS must use HTTPS unless insecure SSL is explicitly enabled');
  }
}

export function createStaticSite(input: Omit<StaticSite, 'id'> & { id?: string }): StaticSite {
  const site: StaticSite = { ...input, id: siteId(input.id), config: { ...input.config, mirrors: [...input.config.mirrors], hooks: [...input.config.hooks] } };
  validateSite(site); return site;
}

export function createCmsSite(input: Omit<CmsSite, 'id'> & { id?: string }): CmsSite {
  const site: CmsSite = { ...input, id: siteId(input.id), config: { ...input.config, adapterOptions: { ...input.config.adapterOptions } } };
  validateSite(site); return site;
}

export type RemoteBinding = {
  siteId: SiteId;
  articleId: string;
  remoteId?: string;
  remotePath?: string;
  remoteRevision?: string;
  baseContentHash?: string;
  syncedAt: string;
};

export type Template = {
  id: string;
  name: string;
  frameworkId: StaticFramework;
  kind: ArticleKindLike;
  frontMatter: string;
  isBuiltin: boolean;
  version: number;
};
type ArticleKindLike = 'post' | 'page';
