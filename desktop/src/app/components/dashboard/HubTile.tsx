import { useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { DesktopItem } from "./desktopTypes";
import { typeClass } from "./desktopStyleUtils";
import { DefaultIcon } from "./DefaultIcon";

export function HubTile({
  item,
  customIcon,
  layout,
  placesIconSize,
  desktopTextSize,
  desktopIconSize,
  onOpen,
  onIconChange,
  onIconClear
}: {
  item: DesktopItem;
  customIcon?: string;
  layout: "place" | "desktop";
  placesIconSize: number;
  desktopTextSize: number;
  desktopIconSize: number;
  onOpen: () => void;
  onIconChange: (dataUrl: string) => void;
  onIconClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [iconBroken, setIconBroken] = useState(false);
  const iconSize =
    layout === "place" ? placesIconSize : Math.round(desktopIconSize * 0.55);

  const openEditPicker = () => fileRef.current?.click();

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setIconBroken(false);
        onIconChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const iconNode = customIcon && !iconBroken ? (
    <img
      src={customIcon}
      alt=""
      className="tile-custom-img"
      draggable={false}
      onError={() => setIconBroken(true)}
    />
  ) : (
    <DefaultIcon item={item} size={iconSize} />
  );

  const hiddenInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hub-file-input"
      onChange={onFilePicked}
    />
  );

  if (layout === "place") {
    return (
      <div className="hub-place-wrap">
        <button
          type="button"
          className={`place-row ${typeClass(item)}`}
          title={`${item.displayName}\nClick: open`}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          <span
            className="place-icon"
            style={{
              width: placesIconSize + 10,
              height: placesIconSize + 10
            }}
          >
            {iconNode}
          </span>
          <span className="place-name">{item.displayName}</span>

          <span
            className="tile-edit-btn place-edit-abs"
            title="Change icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openEditPicker();
            }}
          >
            <Pencil size={11} />
          </span>

          {customIcon && (
            <span
              className="tile-reset-inline place-reset-abs"
              title="Reset default icon"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onIconClear();
              }}
            >
              <X size={11} />
            </span>
          )}
        </button>
        {hiddenInput}
      </div>
    );
  }

  return (
    <div className="hub-desktop-wrap">
      <button
        type="button"
        className={`icon-tile ${typeClass(item)}`}
        title={`${item.displayName}\nClick: open`}
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        <span
          className="tile-icon"
          style={{ width: desktopIconSize, height: desktopIconSize }}
        >
          {iconNode}
        </span>
        <span className="tile-name" style={{ fontSize: desktopTextSize }}>
          {item.displayName}
        </span>

        <span
          className="tile-edit-btn tile-edit-float"
          title="Change icon"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openEditPicker();
          }}
        >
          <Pencil size={11} />
        </span>

        {customIcon && (
          <span
            className="tile-reset-float"
            title="Reset default icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onIconClear();
            }}
          >
            <X size={11} />
          </span>
        )}
      </button>
      {hiddenInput}
    </div>
  );
}