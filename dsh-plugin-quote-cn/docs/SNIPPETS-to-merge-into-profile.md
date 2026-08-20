# 不要把这段再贴进 ~/.dsh/profiles/web/cordis.patch.yml
#
# `dsh plugin add` 会把本包装成 bundle 层，cordis.patch.yml 已自动注入。
# 只有在你禁用了 bundle、想手工挂一行时才需要下面这段。

- insert:
    - id: quote-cn
      name: '@zhuyeqi/dsh-plugin-quote-cn'
      inject: [timer]
      config:
        pollIntervalMs: 5000
        defaultProvider: eastmoney
