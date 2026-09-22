import { Dropdown } from "~/component/dropdown"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import "./user-menu.css"

export function UserMenu(props: { email: string | null | undefined }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-component="user-menu">
      <Dropdown trigger={props.email ?? ""} align="right">
        <a href={language.route("/auth/logout")} data-slot="item">
          {i18n.t("user.logout")}
        </a>
      </Dropdown>
    </div>
  )
}
