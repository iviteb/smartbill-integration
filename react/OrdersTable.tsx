import React, { Component } from 'react'
import {
  Table,
  ActionMenu,
  ButtonWithIcon,
  Tag,
  Spinner,
  DatePicker,
  Link,
} from 'vtex.styleguide'
import { FormattedCurrency } from 'vtex.format-currency'
import PropTypes from 'prop-types'
import { defineMessages, FormattedMessage } from 'react-intl'

import settings from './settings'
import styles from './style.css'
import { requestHeaders } from './utils/constants'

function FormattedMessageFixed(props) {
  return <FormattedMessage {...props} />
}

const messages = defineMessages({
  searchBy: { id: 'admin/order.search-by' },
  date: { id: 'admin/order.date' },
  orderTotal: { id: 'admin/order.total' },
  receiver: { id: 'admin/order.receiver' },
  customer: { id: 'admin/order.customer' },
  payment: { id: 'admin/order.payment' },
  status: { id: 'admin/order.status' },
  waitingAuth: { id: 'admin/order.status.waiting-ffmt-authorization' },
  paymentPending: { id: 'admin/order.status.payment-pending' },
  paymentApproved: { id: 'admin/order.status.payment-approved' },
  readyForHandling: { id: 'admin/order.status.ready-for-handling' },
  handling: { id: 'admin/order.status.handling' },
  invoiced: { id: 'admin/order.status.invoiced' },
  canceled: { id: 'admin/order.status.canceled' },
  windowToCancel: { id: 'admin/order.status.window-to-cancel' },
  clearFilters: { id: 'admin/order.clear-filters' },
  filterStatus: { id: 'admin/order.filter-status' },
  showRows: { id: 'admin/order.show-rows' },
  of: { id: 'admin/order.of' },
  invoiceLink: { id: 'admin/order.invoice-link' },
})

const initialState = {
  items: [],
  paging: {
    total: 0,
    currentPage: 1,
    perPage: 15,
    pages: 1,
  },
  currentItemFrom: 1,
  currentItemTo: 0,
  searchValue: '',
  itemsLength: 0,
  f_shippingEstimate: null,
  f_status: null,
  f_orderDate: null,
  async: [],
  tableIsLoading: true,
}

class OrdersTable extends Component<any, any> {
  static propTypes = {
    intl: PropTypes.object,
  }

  constructor(props: any) {
    super(props)
    this.state = initialState

    this.getItems = this.getItems.bind(this)
    this.handleNextClick = this.handleNextClick.bind(this)
    this.handlePrevClick = this.handlePrevClick.bind(this)
    this.handleInputSearchChange = this.handleInputSearchChange.bind(this)
    this.handleInputSearchSubmit = this.handleInputSearchSubmit.bind(this)
    this.handleInputSearchClear = this.handleInputSearchClear.bind(this)
    this.filterStatus = this.filterStatus.bind(this)
    this.filterOrderDate = this.filterOrderDate.bind(this)
    this.handleResetFilters = this.handleResetFilters.bind(this)
  }

  handleResetFilters() {
    this.setState(
      {
        searchValue: '',
        f_shippingEstimate: null,
        f_status: null,
        f_orderDate: null,
        currentItemFrom: 1,
      },
      this.getItems
    )
  }

  hasFiltersApplied() {
    const { f_status, f_shippingEstimate, searchValue, f_orderDate } =
      this.state

    return (
      f_status !== null ||
      f_shippingEstimate !== null ||
      searchValue !== '' ||
      f_orderDate !== null
    )
  }

  handleNextClick() {
    const { paging } = this.state

    paging.currentPage += 1
    const currentItemFrom = this.state.currentItemFrom + paging.perPage
    const currentItemTo = this.state.currentItemTo + paging.perPage

    this.setState({ paging, currentItemFrom, currentItemTo }, this.getItems)
  }

  handlePrevClick() {
    const { paging } = this.state

    if (paging.currentPage === 0) return
    paging.currentPage -= 1
    const currentItemFrom = this.state.currentItemFrom - paging.perPage
    const currentItemTo = this.state.currentItemTo - paging.perPage

    this.setState({ paging, currentItemFrom, currentItemTo }, this.getItems)
  }

  handleInputSearchChange(e) {
    this.setState({ searchValue: e.target.value })
  }

  handleInputSearchClear() {
    this.setState({ searchValue: '' }, this.getItems)
  }

  filterStatus(f_status) {
    const { paging } = this.state

    paging.currentPage = 1
    this.setState({ f_status, paging, currentItemFrom: 1 }, this.getItems)
  }

  filterOrderDate(f_orderDate) {
    const { paging } = this.state

    paging.currentPage = 1
    this.setState({ f_orderDate, paging, currentItemFrom: 1 }, this.getItems)
  }

  handleInputSearchSubmit(e) {
    const q = e && e.target && e.target.value

    this.setState({ searchValue: q }, this.getItems)
  }

  getItems() {
    this.setState({ tableIsLoading: true })
    const { paging, f_shippingEstimate, f_status, searchValue, f_orderDate } =
      this.state

    let url = `/api/oms/pvt/orders?page=${paging.currentPage}&per_page=${paging.perPage
      }&_=${Date.now()}`

    if (f_shippingEstimate !== null) {
      url += `&f_shippingEstimate=${f_shippingEstimate}`
    }

    if (f_orderDate !== null) {
      const date = f_orderDate.toLocaleDateString('fr-CA')

      url += `&f_creationDate=creationDate:[${date}T00:00:00.000Z TO ${date}T23:59:59.999Z]`
    }

    if (f_status !== null) {
      url += `&f_status=${f_status}`
    } else {
      url += `&f_status=ready-for-handling,handling,invoiced,canceled,waiting-ffmt-authorization,payment-pending,on-order-completed-ffm,order-accepted,window-to-cancel`
    }

    if (searchValue !== '') {
      url += `&q=${searchValue}`
    }

    try {
      fetch(url, {
        headers: requestHeaders,
      })
        .then(res => res.json())
        .then(json =>
          this.setState({
            items: json.list,
            paging: json.paging,
            currentItemTo: json.paging.perPage * json.paging.currentPage,
            tableIsLoading: false,
          })
        )
        .then(() => {
          const { items, async } = this.state

          Object.keys(items).forEach(function (key) {
            fetch(`/api/oms/pvt/orders/${items[key].orderId}/?_=${Date.now()}`)
              .then(res => res.json())
              .then(json => {
                let notShipped = false
                let shipping = 0
                let awbStatus = 'n/a'
                let trackingNumber = null
                const courier = null
                let invoiceNumber = null
                let invoiceUrl = null

                if (json.packageAttachment.packages.length) {
                  const packageItem = json.packageAttachment.packages[0]

                  if (
                    packageItem.invoiceNumber &&
                    !packageItem.trackingNumber
                  ) {
                    notShipped = true
                  }

                  invoiceNumber = packageItem.invoiceNumber ?? null
                  trackingNumber = packageItem.trackingNumber ?? null
                  invoiceUrl = packageItem.invoiceUrl ?? null

                  if (
                    packageItem.courierStatus &&
                    packageItem.courierStatus.data.length
                  ) {
                    awbStatus = packageItem.courierStatus.data[0].description
                  }
                }

                if (json.totals.length) {
                  const ship = json.totals.filter(function (item) {
                    return item.id === 'Shipping'
                  })

                  if (ship.length) {
                    shipping = ship[0].value
                  }
                }

                const orderIndex = items.findIndex(function (item) {
                  return item.orderId == json.orderId
                })

                if (orderIndex !== null) {
                  items[orderIndex].shipping = shipping
                  items[orderIndex].notShipped = notShipped
                  items[orderIndex].awbStatus = awbStatus
                  items[orderIndex].trackingNumber = trackingNumber
                  items[orderIndex].courier = courier
                  items[orderIndex].invoiceNumber = invoiceNumber
                  items[orderIndex].invoiceUrl = invoiceUrl
                }

                async.push({
                  orderId: json.orderId,
                  shipping,
                  notShipped,
                  awbStatus,
                  invoiceUrl,
                })
              })
          })

          this.setState({ async, items })
        })
    } catch (err) {
      this.setState({ posted: false })
    }
  }

  componentDidMount() {
    this.getItems()
  }

  private getSchema() {
    const { formatMessage } = this.props.intl

    return {
      properties: {
        orderId: {
          title: '#',
        },
        creationDate: {
          title: formatMessage({ id: messages.date.id }),
          cellRenderer: ({ cellData }) => {
            return new Intl.DateTimeFormat('en-GB', {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              second: 'numeric',
              hour12: false,
            }).format(new Date(cellData))
          },
        },
        totalValue: {
          title: formatMessage({ id: messages.orderTotal.id }),
          cellRenderer: ({ cellData }) => {
            return (
              <FormattedCurrency
                key={cellData}
                value={cellData / settings.constants.price_multiplier}
              />
            )
          },
        },
        clientName: {
          title: formatMessage({ id: messages.customer.id }),
        },
        paymentNames: {
          title: formatMessage({ id: messages.payment.id }),
        },
        status: {
          title: formatMessage({ id: messages.status.id }),
          cellRenderer: ({ cellData, rowData }) => {
            const tagColor = cellData === 'invoiced' ? 'blue' : 'green'
            let extraMessage

            const data = this.state.async.filter(function (item) {
              return item.orderId === rowData.orderId
            })

            const id = `admin/order.status.${cellData}`

            if (data.length) {
              return (
                <Tag bgColor={tagColor} color="#fff">
                  <FormattedMessageFixed id={id} />
                  {extraMessage}
                </Tag>
              )
            }

            return <Spinner size={15} />
          },
        },
        invoiceLink: {
          title: formatMessage({ id: messages.invoiceLink.id }),
          cellRenderer: ({ rowData }) => {
            const data = this.state.async.filter(function (item) {
              return item.orderId === rowData.orderId
            })

            if (data.length) {
              if (data[0].invoiceUrl) {
                return (
                  <div
                    onClick={e => {
                      e.stopPropagation()
                    }}
                  >
                    <Link target="_blank" href={data[0].invoiceUrl}>
                      link
                    </Link>
                  </div>
                )
              }

              return null
            }

            return <Spinner size={15} />
          },
        },
      },
    }
  }

  public getFilterStatusOptions() {
    const { formatMessage } = this.props.intl

    return [
      {
        label: (
          <FormattedMessage id="admin/order.status.waiting-ffmt-authorization" />
        ),
        onClick: () =>
          this.filterStatus(
            'waiting-ffmt-authorization,on-order-completed-ffm,order-accepted'
          ),
      },
      {
        label: <FormattedMessage id="admin/order.status.payment-pending" />,
        onClick: () => this.filterStatus('payment-pending'),
      },
      {
        label: <FormattedMessage id="admin/order.status.payment-approved" />,
        onClick: () => this.filterStatus('payment-approved'),
      },
      {
        label: <FormattedMessage id="admin/order.status.ready-for-handling" />,
        onClick: () => this.filterStatus('ready-for-handling'),
      },
      {
        label: <FormattedMessage id="admin/order.status.handling" />,
        onClick: () => this.filterStatus('handling'),
      },
      {
        label: <FormattedMessage id="admin/order.status.invoiced" />,
        onClick: () => this.filterStatus('invoiced'),
      },
      {
        label: <FormattedMessage id="admin/order.status.canceled" />,
        onClick: () => this.filterStatus('canceled'),
      },
      {
        label: <FormattedMessage id="admin/order.status.window-to-cancel" />,
        onClick: () => this.filterStatus('window-to-cancel'),
      },
    ]
  }

  public render() {
    const { paging } = this.state
    const { formatMessage } = this.props.intl

    return (
      <div>
        <div className="flex justify-end">
          <div className="ma3" />
        </div>
        <div className={`flex items-center ${styles.tableHeaderButtons}`}>
          {this.hasFiltersApplied() && (
            <div className="ma3">
              <ButtonWithIcon
                variation="secondary"
                size="small"
                onClick={() => this.handleResetFilters()}
              >
                {formatMessage({ id: messages.clearFilters.id })}
              </ButtonWithIcon>
            </div>
          )}
          <div className="ma3">
            <DatePicker
              size="small"
              placeholder={formatMessage({ id: messages.date.id })}
              value={this.state.f_orderDate}
              onChange={date => this.filterOrderDate(date)}
              locale="en-GB"
            />
          </div>
          <div className="ma3">
            <ActionMenu
              label={formatMessage({ id: messages.filterStatus.id })}
              align="right"
              buttonProps={{
                variation: 'secondary',
                size: 'small',
              }}
              options={this.getFilterStatusOptions()}
            />
          </div>
        </div>

        <Table
          fullWidth
          loading={this.state.tableIsLoading}
          items={this.state.items}
          schema={this.getSchema()}
          onRowClick={({ rowData }) => {
            window.open(`/admin/smartbill/order/${rowData.orderId}`)
          }}
          toolbar={{
            inputSearch: {
              value: this.state.searchValue,
              placeholder: formatMessage({ id: messages.searchBy.id }),
              onChange: this.handleInputSearchChange,
              onClear: this.handleInputSearchClear,
              onSubmit: this.handleInputSearchSubmit,
            },
          }}
          pagination={{
            onNextClick: this.handleNextClick,
            onPrevClick: this.handlePrevClick,
            textShowRows: formatMessage({ id: messages.showRows.id }),
            textOf: formatMessage({ id: messages.of.id }),
            currentItemFrom: this.state.currentItemFrom,
            currentItemTo: this.state.currentItemTo,
            totalItems: paging.total,
          }}
        />
      </div>
    )
  }
}

export default OrdersTable
